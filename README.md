# ZLD Water Treatment Monitoring Website

This project is a beginner-friendly Zero Liquid Discharge (ZLD) water treatment monitoring dashboard built with Python Flask, SQLite, HTML, CSS, and JavaScript. It is designed to receive sensor readings from an ESP32 device and display them in a live dashboard.

## Features

- Real-time dashboard for pH, turbidity, flow rates, tank level, and pump status
- Turbidity raw ADC display; NTU requires sensor calibration
- pH sensor connection status is shown as unplugged until the UART sensor is connected
- ESP32 HTTP POST integration with Flask backend
- SQLite database for storing readings
- Automatic refresh every 4 seconds
- Historical charts for trend analysis
- Offline detection when the ESP32 stops sending data
- Connected/unplugged status for each individual sensor
- Inlet/recovery flow mismatch alerts with logged status and CSV export
- SMTP email notification to the authority when a mismatch episode starts
- Automatic ESP8266 discovery on the same local network
- Sample data mode for testing without hardware
- Mobile-friendly responsive layout

## Project Structure

- `app.py` – Flask backend and API endpoints
- `templates/index.html` – dashboard HTML layout
- `static/style.css` – dashboard styling
- `static/script.js` – live updates and charts
- `database.db` – SQLite database created automatically
- `esp32/esp32_zld_sender.ino` – ESP32 Arduino code
- `requirements.txt` – Python dependencies

## 1. Install Python dependencies

Open a terminal in the project folder and run:

```bash
python -m venv venv
```

Then activate the environment:

- Windows:

```bash
venv\Scripts\activate
```

- macOS/Linux:

```bash
source venv/bin/activate
```

Install the dependencies:

```bash
pip install -r requirements.txt
```

## 2. Run the Flask app

From the project folder:

```bash
python app.py
```

The dashboard will be available here:

```text
http://localhost:5000
```

The app will create `database.db` automatically the first time it runs.

## 3. ESP32 connection setup

The ESP32 can send readings to the Flask server using HTTP POST requests.

### Example ESP32 Wi-Fi settings

Update your Wi-Fi SSID and password in the Arduino code before uploading:

```cpp
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
// No fixed server URL is needed. The sketch discovers Flask automatically.
```

### Wiring assumptions

These are general assumptions for a beginner project:

- pH sensor output connected to an analog input or supported signal board
- Turbidity sensor connected to analog input
- AJ-SR04M waterproof ultrasonic sensor:
  - VCC → VIN/5V according to the module specification
  - GND → GND
  - TRIG → D6
  - ECHO → D5 through a voltage divider
- 4-in-1 UART pH sensor:
  - VCC and GND → according to the sensor specification
  - Sensor TX → D3
  - Sensor RX → D4
  - Use a level converter or voltage divider if the sensor UART is 5 V
- Flow sensors connected to digital inputs or pulse-count interfaces
- Pump relay connected to GPIO via transistor/relay module
- ESP32 powered with a stable 5V supply or USB power

Note:

- Exact pin numbers depend on your circuit and sensor modules.
- The sketch reads pH UART messages in plain-text numeric form, such as `7.20`
  or `pH:7.20`, at 9600 baud. A binary or Modbus sensor needs its protocol
  and register map implemented in `readPhSensor()` before it can be read.
- AJ-SR04M has a larger minimum measuring distance than a typical HC-SR04.
  Keep the nearest tank surface approximately 20–25 cm away and adjust
  `TANK_EMPTY_DISTANCE_CM` and `TANK_FULL_DISTANCE_CM` in the sketch for
  the actual tank.
- The example code uses a simplified simulated sensor input to show how data is sent.
- If you have real sensors, replace the mock readings in the code with actual sensor read values.

## 4. ESP32 Arduino code

The Arduino file is stored at:

```text
esp32/esp32_zld_sender.ino
```

Open it in the Arduino IDE, update the Wi-Fi and server settings, and upload it to the ESP32.

## Automatic laptop discovery

The ESP sketch and Flask app use a small UDP discovery handshake on port `5001`:

1. The dashboard calls `/api/discover` and broadcasts `ZLD_DISCOVER` on the local network.
2. The ESP8266 replies with its device name.
3. The ESP8266 learns the laptop IP from that reply.
4. The ESP8266 sends sensor readings to that laptop's `/api/sensor-data` endpoint.

This means the laptop IP does not need to be written in the sketch. The laptop and ESP must:

- Be connected to the same Wi-Fi network.
- Be on the same subnet.
- Allow Flask/Python through the Windows firewall on TCP port `5000`.
- Allow local UDP broadcast traffic on UDP port `5001`.

Guest Wi-Fi networks may block device-to-device traffic and prevent discovery. If discovery
fails, allow Python through Windows Firewall and test with a normal private/home Wi-Fi network.
The discovery endpoint returns an empty device list when no ESP responds; this is handled
without crashing the dashboard.

## 5. API endpoints

### POST /api/sensor-data

The ESP32 should send JSON like this:

```json
{
  "ph": 7.2,
  "turbidity": null,
  "turbidity_raw_adc": 29,
  "inlet_flow": 2.5,
  "recovery_flow": 1.8,
  "reject_flow": 0.7,
  "water_level": 15.0,
  "tank_percentage": 75,
  "pump_status": "ON",
  "sensor_status": {
    "ph": "connected",
    "turbidity": "connected",
    "inlet_flow": "connected",
    "recovery_flow": "connected",
    "reject_flow": "connected",
    "water_level": "connected"
  }
}
```

`sensor_status` is optional for backward compatibility. Supported statuses are:
`connected`, `unplugged`, `unknown`, and `not_configured`. A missing value by itself is not
enough to prove that a sensor is physically unplugged. The example sketch therefore uses
`not_configured` for pH, and `unknown` for turbidity and flow sensors when
their hardware cannot be confirmed. Use `unplugged` only when your sensor-specific wiring or
diagnostic check confirms a physical disconnection.

The website displays `turbidity_raw_adc` as a raw ADC reading. It does not label this value
as NTU because an NTU calibration curve depends on the specific turbidity module and water
samples.

### GET /api/latest

Returns the most recent sensor reading.

### GET /api/history

Returns recent historical sensor readings for charting.

### GET /api/export.csv

Downloads the logged readings as CSV, including inlet/recovery/reject flow values and the
flow mismatch flag and details.

## 7. Flow mismatch email configuration

The application compares inlet flow with recovery flow. With the default configuration, an
alert is recorded when the difference is greater than 15% of the larger non-zero reading.
The alert is sent once when a mismatch starts and is re-armed after the readings return within
the limit.

By default, the application uses Gmail SMTP. Gmail requires a Google **App Password** for
SMTP; your normal Gmail password will not work. No password is stored in this project.
To use classic Outlook desktop instead, set `EMAIL_DELIVERY=outlook`.

Set these environment variables before starting Flask. Do not put the SMTP password in source
control:

```text
AUTHORITY_EMAIL=zld.monitoring@gmail.com
FLOW_MISMATCH_TOLERANCE_PERCENT=15
EMAIL_DELIVERY=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-sender@gmail.com
SMTP_PASSWORD=your-16-character-google-app-password
SMTP_FROM=your-sender@gmail.com
```

For Gmail, use an app password with SMTP after enabling two-step verification. The dashboard
shows the active mismatch and the latest readings table includes the alert details.

The dashboard also provides a local-only **Send Test Email** button. It calls
`POST /api/test-email` and reports success only after Gmail accepts the message. You can test
the endpoint directly from PowerShell:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:5000/api/test-email" -Method POST
```

## 8. Sample data mode

If no real ESP32 data has been received, the app automatically shows clearly labeled sample data. This keeps testing easy without mixing demo data with real readings.

## 9. Troubleshooting

### Flask app does not start
- Make sure Python is installed.
- Activate the virtual environment.
- Run `pip install -r requirements.txt` again.

### ESP32 cannot connect to server
- Ensure the ESP32 and laptop/PC are on the same network or the server IP is correct.
- Check that the Flask app is running.
- Confirm the server URL in the Arduino code matches the computer IP and port.

### Dashboard shows offline
- Confirm the ESP32 is powered and connected to Wi-Fi.
- Check the request frequency and server URL.
- Verify the JSON payload is valid.

## 10. Notes for students

This project is intentionally simple and beginner-friendly so it can be studied and modified easily. You can extend it later with real sensors, charts, alarm thresholds, or automatic email alerts.
