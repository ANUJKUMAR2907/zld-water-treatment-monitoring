
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiUdp.h>
#include <SoftwareSerial.h>
#include <math.h>

// ---------- WIFI DETAILS ----------
const char* ssid = "Anuj";
const char* password = "1234567890";

// ---------- FLASK DISCOVERY ----------
const unsigned int DISCOVERY_PORT = 5001;
const unsigned long DISCOVERY_INTERVAL_MS = 30000;

WiFiUDP discoveryUdp;
IPAddress flaskServerIp;
bool flaskServerDiscovered = false;
unsigned long lastDiscovery = 0;

// ---------- PIN CONFIGURATION ----------
// Your actual wiring:
// Flow sensors: D1, D2, D7c
// AJ-SR04M: TRIG -> D6, ECHO -> D5 through voltage divider
// Turbidity: A0

#define INLET_FLOW_PIN D1
#define RECOVERY_FLOW_PIN D2
#define REJECT_FLOW_PIN D7
#define TRIG_PIN D6
#define ECHO_PIN D5
#define TURBIDITY_PIN A0
// 4-in-1 UART sensor: sensor TX -> D3, sensor RX <- D4.
// These pins are also used by the ESP8266 bootloader; disconnect the sensor
// during upload if the board does not enter programming mode.
#define PH_RX_PIN D3
#define PH_TX_PIN D4
#define PH_BAUD_RATE 9600

SoftwareSerial phSerial(PH_RX_PIN, PH_TX_PIN);

// ---------- TANK CONFIGURATION ----------
// Temporary test calibration: 50 cm is treated as an empty tank.
// Replace these values with the actual empty/full distances after testing.
const float TANK_EMPTY_DISTANCE_CM = 50.0;
const float TANK_FULL_DISTANCE_CM = 25.0;

const unsigned long ULTRASONIC_TIMEOUT_US = 60000UL;

// Verify using your actual flow sensors.
const float PULSES_PER_LITRE = 450.0;

// ---------- FLOW SENSOR VARIABLES ----------
volatile unsigned long inletPulses = 0;
volatile unsigned long recoveryPulses = 0;
volatile unsigned long rejectPulses = 0;

float inletFlow = 0.0;
float recoveryFlow = 0.0;
float rejectFlow = 0.0;

float inletTotal = 0.0;
float recoveryTotal = 0.0;
float rejectTotal = 0.0;

unsigned long lastFlowUpdate = 0;

bool inletPulseSeen = false;
bool recoveryPulseSeen = false;
bool rejectPulseSeen = false;

float phValue = NAN;
bool phReadingSeen = false;
String phInputLine;

// ---------- FLOW INTERRUPTS ----------
void ICACHE_RAM_ATTR inletPulseISR() {
  inletPulses++;
}

void ICACHE_RAM_ATTR recoveryPulseISR() {
  recoveryPulses++;
}

void ICACHE_RAM_ATTR rejectPulseISR() {
  rejectPulses++;
}

// ---------- WIFI CONNECTION ----------
void connectToWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  Serial.print("Connecting to Wi-Fi");

  unsigned long startTime = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - startTime < 20000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi connected");
    Serial.print("ESP8266 IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connection failed");
  }
}

// ---------- DISCOVER FLASK SERVER ----------
bool discoverFlaskServer() {
  discoveryUdp.stop();

  if (!discoveryUdp.begin(DISCOVERY_PORT)) {
    Serial.println("UDP start failed");
    return false;
  }

  discoveryUdp.beginPacket(
    IPAddress(255, 255, 255, 255),
    DISCOVERY_PORT
  );

  discoveryUdp.print("ZLD_DISCOVER");
  discoveryUdp.endPacket();

  unsigned long started = millis();

  while (millis() - started < 1500) {
    int packetSize = discoveryUdp.parsePacket();

    if (packetSize <= 0) {
      delay(10);
      yield();
      continue;
    }

    char response[64];
    int length = discoveryUdp.read(
      response, sizeof(response) - 1
    );

    if (length < 0) length = 0;
    response[length] = '\0';

    if (String(response).startsWith("ZLD_DEVICE|")) {
      flaskServerIp = discoveryUdp.remoteIP();
      flaskServerDiscovered = true;
      lastDiscovery = millis();

      Serial.print("Flask server discovered at ");
      Serial.println(flaskServerIp);

      return true;
    }
  }

  Serial.println("Flask server not discovered");
  return false;
}

// ---------- LISTEN FOR DISCOVERY ----------
void listenForDiscovery() {
  int packetSize = discoveryUdp.parsePacket();

  if (packetSize <= 0) return;

  IPAddress senderIP = discoveryUdp.remoteIP();
  unsigned int senderPort = discoveryUdp.remotePort();

  char request[32];
  int length = discoveryUdp.read(
    request, sizeof(request) - 1
  );

  if (length < 0) length = 0;
  request[length] = '\0';

  if (String(request) == "ZLD_DISCOVER") {
    discoveryUdp.beginPacket(senderIP, senderPort);
    discoveryUdp.print("ZLD_DEVICE|ESP8266_ZLD");
    discoveryUdp.endPacket();

    flaskServerIp = senderIP;
    flaskServerDiscovered = true;
    lastDiscovery = millis();
  }
}

// Reads a pH value from a UART sensor that transmits plain text, for example
// "7.20", "pH:7.20", or "pH Value : 7.20". Binary/Modbus sensors need
// their register map here.
void readPhSensor() {
  while (phSerial.available()) {
    char character = static_cast<char>(phSerial.read());

    if (character == '\r' || character == '\n') {
      if (phInputLine.length() > 0) {
        String line = phInputLine;
        line.trim();
        line.toLowerCase();

        Serial.print("pH UART received: ");
        Serial.println(line);

        int marker = line.indexOf("ph");
        if (marker >= 0) {
          line = line.substring(marker + 2);
          int separator = line.indexOf(':');
          if (separator < 0) separator = line.indexOf('=');
          if (separator >= 0) line = line.substring(separator + 1);
        }

        line.trim();
        char* endPointer = nullptr;
        float parsed = strtof(line.c_str(), &endPointer);

        if (endPointer != line.c_str() &&
            isfinite(parsed) && parsed >= 0.0 && parsed <= 14.0) {
          phValue = parsed;
          phReadingSeen = true;
        } else {
          Serial.print("pH UART value is invalid: ");
          Serial.println(line);
        }
      }
      phInputLine = "";
    } else if (character >= 32 && character <= 126 &&
               phInputLine.length() < 64) {
      phInputLine += character;
    }
  }
}

// ---------- AJ-SR04M ULTRASONIC ----------
float readDistanceCM() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(5);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);

  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(
    ECHO_PIN, HIGH, ULTRASONIC_TIMEOUT_US
  );

  if (duration == 0) {
    Serial.println("Ultrasonic: No echo received");
    return -1.0;
  }

  float distance = duration * 0.0343 / 2.0;

  // AJ-SR04M readings below approximately 20 cm are inside its blind zone.
  if (distance < 20.0 || distance > 600.0) {
    Serial.print("Ultrasonic: Out-of-range reading: ");
    Serial.print(distance, 1);
    Serial.println(" cm");
    return -1.0;
  }

  return distance;
}

// ---------- UPDATE FLOW SENSORS ----------
void updateFlowSensors() {
  unsigned long now = millis();

  if (now - lastFlowUpdate < 1000) return;

  unsigned long elapsedMs = now - lastFlowUpdate;
  float elapsedMinutes = elapsedMs / 60000.0;

  noInterrupts();

  unsigned long inPulses = inletPulses;
  unsigned long recPulses = recoveryPulses;
  unsigned long rejPulses = rejectPulses;

  inletPulses = 0;
  recoveryPulses = 0;
  rejectPulses = 0;

  interrupts();

  if (inPulses > 0) inletPulseSeen = true;
  if (recPulses > 0) recoveryPulseSeen = true;
  if (rejPulses > 0) rejectPulseSeen = true;

  inletFlow = (inPulses / PULSES_PER_LITRE) / elapsedMinutes;
  recoveryFlow = (recPulses / PULSES_PER_LITRE) / elapsedMinutes;
  rejectFlow = (rejPulses / PULSES_PER_LITRE) / elapsedMinutes;

  inletTotal += inPulses / PULSES_PER_LITRE;
  recoveryTotal += recPulses / PULSES_PER_LITRE;
  rejectTotal += rejPulses / PULSES_PER_LITRE;

  lastFlowUpdate = now;
}

// ---------- JSON NUMBER ----------
String jsonNumber(float value, int decimals) {
  if (isnan(value) || isinf(value)) {
    return "null";
  }

  return String(value, decimals);
}

// ---------- FLOW STATUS ----------
String flowStatus(bool pulseSeen) {
  // No pulses alone cannot prove disconnection.
  return pulseSeen ? "connected" : "unknown";
}

// ---------- TANK PERCENTAGE ----------
int calculateTankPercentage(float distance) {
  if (distance < 0) return -1;

  float percentage =
    (TANK_EMPTY_DISTANCE_CM - distance) * 100.0 /
    (TANK_EMPTY_DISTANCE_CM - TANK_FULL_DISTANCE_CM);

  return constrain((int)round(percentage), 0, 100);
}

// ---------- SERIAL SENSOR STATUS ----------
void printSensorStatus(
  float distance,
  int turbidityRaw,
  int tankPercentage
) {
  Serial.println();
  Serial.println("----- ZLD SENSOR STATUS -----");

  Serial.print("Wi-Fi: ");
  Serial.println(
    WiFi.status() == WL_CONNECTED
      ? "CONNECTED" : "DISCONNECTED"
  );

  Serial.print("Flask server: ");
  Serial.println(
    flaskServerDiscovered
      ? "DISCOVERED" : "NOT DISCOVERED"
  );

  Serial.print("pH sensor: ");
  if (phReadingSeen) {
    Serial.print("connected | reading: ");
    Serial.println(phValue, 2);
  } else {
    Serial.println("no valid UART reading | reading: --");
  }

  Serial.print("Turbidity raw ADC: ");
  Serial.println(turbidityRaw);

  Serial.print("Inlet flow sensor: ");
  Serial.print(flowStatus(inletPulseSeen));
  Serial.print(" | flow: ");
  Serial.print(inletFlow, 2);
  Serial.println(" L/min");

  Serial.print("Recovery flow sensor: ");
  Serial.print(flowStatus(recoveryPulseSeen));
  Serial.print(" | flow: ");
  Serial.print(recoveryFlow, 2);
  Serial.println(" L/min");

  Serial.print("Reject flow sensor: ");
  Serial.print(flowStatus(rejectPulseSeen));
  Serial.print(" | flow: ");
  Serial.print(rejectFlow, 2);
  Serial.println(" L/min");

  Serial.print("Ultrasonic sensor: ");

  if (distance >= 0) {
    Serial.println("ECHO RECEIVED");

    Serial.print("Distance: ");
    Serial.print(distance, 1);
    Serial.print(" cm | Tank: ");

    if (tankPercentage >= 0) {
      Serial.print(tankPercentage);
      Serial.println("%");
    } else {
      Serial.println("--");
    }
  } else {
    Serial.println("NO VALID ECHO | distance: --");
  }

  Serial.println("-----------------------------");
}

// ---------- BUILD JSON PAYLOAD ----------
String buildJsonPayload() {
  updateFlowSensors();
  readPhSensor();

  float distance = readDistanceCM();
  int tankPercentage = calculateTankPercentage(distance);
  int turbidityRaw = analogRead(TURBIDITY_PIN);

  printSensorStatus(distance, turbidityRaw, tankPercentage);

  String json = "{";

  json += "\"ph\":";
  json += phReadingSeen ? jsonNumber(phValue, 2) : "null";
  json += ",";
  // Keep turbidity raw ADC in its own field.
  json += "\"turbidity\":null,";
  json += "\"turbidity_raw_adc\":";
  json += String(turbidityRaw);
  json += ",";

  json += "\"inlet_flow\":";
  json += jsonNumber(inletFlow, 2);
  json += ",";

  json += "\"recovery_flow\":";
  json += jsonNumber(recoveryFlow, 2);
  json += ",";

  json += "\"reject_flow\":";
  json += jsonNumber(rejectFlow, 2);
  json += ",";

  json += "\"inlet_total_litres\":";
  json += jsonNumber(inletTotal, 2);
  json += ",";

  json += "\"recovery_total_litres\":";
  json += jsonNumber(recoveryTotal, 2);
  json += ",";

  json += "\"reject_total_litres\":";
  json += jsonNumber(rejectTotal, 2);
  json += ",";

  json += "\"water_level\":";
  json += distance >= 0
    ? jsonNumber(distance, 1) : "null";
  json += ",";

  json += "\"ultrasonic_distance_cm\":";
  json += distance >= 0
    ? jsonNumber(distance, 1) : "null";
  json += ",";

  json += "\"tank_percentage\":";
  json += tankPercentage >= 0
    ? String(tankPercentage) : "null";
  json += ",";

  json += "\"pump_status\":\"OFF\",";

  json += "\"sensor_status\":{";
  json += "\"ph\":\"";
  json += phReadingSeen ? "connected" : "unknown";
  json += "\",";
  json += "\"turbidity\":\"connected\",";

  json += "\"inlet_flow\":\"";
  json += flowStatus(inletPulseSeen);
  json += "\",";

  json += "\"recovery_flow\":\"";
  json += flowStatus(recoveryPulseSeen);
  json += "\",";

  json += "\"reject_flow\":\"";
  json += flowStatus(rejectPulseSeen);
  json += "\",";

  json += "\"water_level\":\"";
  json += distance >= 0 ? "connected" : "unplugged";
  json += "\"";

  json += "}}";

  return json;
}

// ---------- SEND DATA TO FLASK ----------
void sendSensorData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi disconnected; reconnecting...");
    connectToWiFi();
    return;
  }

  if (!flaskServerDiscovered ||
      millis() - lastDiscovery >= DISCOVERY_INTERVAL_MS) {
    if (!discoverFlaskServer()) {
      return;
    }
  }

  WiFiClient client;
  HTTPClient http;

  String flaskUrl =
    "http://" + flaskServerIp.toString() +
    ":5000/api/sensor-data";

  if (!http.begin(client, flaskUrl)) {
    Serial.println("Could not initialize HTTP client");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  String payload = buildJsonPayload();
  int responseCode = http.POST(payload);

  Serial.print("POST response: ");
  Serial.println(responseCode);

  if (responseCode > 0) {
    Serial.println(http.getString());
  } else {
    Serial.print("HTTP error: ");
    Serial.println(http.errorToString(responseCode));
  }

  http.end();
}

// ---------- SETUP ----------
void setup() {
  Serial.begin(115200);
  phSerial.begin(PH_BAUD_RATE);
  delay(500);

  pinMode(INLET_FLOW_PIN, INPUT_PULLUP);
  pinMode(RECOVERY_FLOW_PIN, INPUT_PULLUP);
  pinMode(REJECT_FLOW_PIN, INPUT_PULLUP);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  digitalWrite(TRIG_PIN, LOW);

  attachInterrupt(
    digitalPinToInterrupt(INLET_FLOW_PIN),
    inletPulseISR, RISING
  );

  attachInterrupt(
    digitalPinToInterrupt(RECOVERY_FLOW_PIN),
    recoveryPulseISR, RISING
  );

  attachInterrupt(
    digitalPinToInterrupt(REJECT_FLOW_PIN),
    rejectPulseISR, RISING
  );

  lastFlowUpdate = millis();

  connectToWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    discoverFlaskServer();
  }
}

// ---------- MAIN LOOP ----------
void loop() {
  listenForDiscovery();
  sendSensorData();
  delay(5000);
}
