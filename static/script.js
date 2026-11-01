const latestReadings = {
  ph: document.getElementById('phValue'),
  turbidity: document.getElementById('turbidityValue'),
  inletFlow: document.getElementById('inletFlowValue'),
  recoveryFlow: document.getElementById('recoveryFlowValue'),
  rejectFlow: document.getElementById('rejectFlowValue'),
  waterLevel: document.getElementById('waterLevelValue'),
  tankPercentage: document.getElementById('tankPercentageValue'),
  pumpStatus: document.getElementById('pumpStatusValue'),
  esp32Status: document.getElementById('esp32StatusValue'),
  lastUpdate: document.getElementById('lastUpdateText'),
  sensorUpdateTime: document.getElementById('sensorUpdateTime'),
  tankFill: document.getElementById('tankFill'),
  connectionBadge: document.getElementById('connectionBadge'),
  liveModeText: document.getElementById('liveModeText'),
  inletTotal: document.getElementById('inletTotalValue'),
  recoveryTotal: document.getElementById('recoveryTotalValue'),
  rejectTotal: document.getElementById('rejectTotalValue'),
  tableBody: document.getElementById('sensorTableBody'),
  flowMismatchAlert: document.getElementById('flowMismatchAlert'),
  flowMismatchDetails: document.getElementById('flowMismatchDetails'),
  alertsList: document.getElementById('alertsList'),
  systemNotifications: document.getElementById('systemNotifications'),
  testEmailButton: document.getElementById('testEmailButton'),
  testEmailMessage: document.getElementById('testEmailMessage'),
};

const sensorStatusElements = {
  ph: document.getElementById('phConnection'),
  turbidity: document.getElementById('turbidityConnection'),
  inlet_flow: document.getElementById('inletFlowConnection'),
  recovery_flow: document.getElementById('recoveryFlowConnection'),
  reject_flow: document.getElementById('rejectFlowConnection'),
  water_level: document.getElementById('waterLevelConnection'),
};

const qualityChartCtx = document.getElementById('qualityChart');
const flowChartCtx = document.getElementById('flowChart');

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }
  return Number(value).toFixed(digits);
}

function formatSimpleDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString();
}

function getStatusClass(value, thresholds) {
  if (value === null || value === undefined) return 'good';
  if (value > thresholds.critical) return 'critical';
  if (value > thresholds.warning) return 'warning';
  return 'good';
}

function applyMetricValue(elementId, value, suffix = '', digits = 1) {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.textContent = `${formatNumber(value, digits)}${suffix}`;
}

function updateMetricTag(id, value, config) {
  const tag = document.getElementById(id);
  if (!tag) return;

  if (value === null || value === undefined || !Number.isFinite(value)) {
    tag.textContent = 'Unknown';
    tag.className = 'level-tag warning';
    return;
  }

  if (value > config.critical) {
    tag.textContent = 'Critical';
    tag.className = 'level-tag critical';
  } else if (value > config.warning) {
    tag.textContent = 'Warning';
    tag.className = 'level-tag warning';
  } else {
    tag.textContent = 'Normal';
    tag.className = 'level-tag good';
  }
}

function updateSensorStatuses(data) {
  const statuses = data.sensor_status || {};
  Object.entries(sensorStatusElements).forEach(([field, element]) => {
    if (!element) return;
    const status = statuses[field] || (data[field] === null || data[field] === undefined ? 'unknown' : 'connected');
    const labels = {
      connected: 'Connected',
      unplugged: 'Unplugged',
      unknown: 'Unknown',
      not_configured: 'Not configured',
    };
    element.textContent = labels[status] || 'Unknown';
    element.className = `sensor-status ${status}`;
  });
}

function updateSystemDisplay(data) {
  const timestamp = data.timestamp || null;
  const lastUpdateTime = timestamp ? new Date(timestamp) : null;
  const now = new Date();
  const elapsedSeconds = lastUpdateTime ? (now - lastUpdateTime) / 1000 : Infinity;

  if (data.source === 'esp32' && lastUpdateTime && elapsedSeconds <= 15) {
    latestReadings.connectionBadge.textContent = 'Online';
    latestReadings.connectionBadge.className = 'status-badge online';
    latestReadings.esp32Status.textContent = 'Connected';
  } else {
    latestReadings.connectionBadge.textContent = 'Offline';
    latestReadings.connectionBadge.className = 'status-badge offline';
    latestReadings.esp32Status.textContent = 'Disconnected';
  }
  const mirror = document.getElementById('esp32StatusMirror');
  if (mirror) mirror.textContent = latestReadings.esp32Status.textContent;

  latestReadings.lastUpdate.textContent = lastUpdateTime ? formatSimpleDate(lastUpdateTime) : '--';
  latestReadings.sensorUpdateTime.textContent = lastUpdateTime ? formatSimpleDate(lastUpdateTime) : '--';
  const updateMirror = document.getElementById('sensorUpdateMirror');
  if (updateMirror) updateMirror.textContent = lastUpdateTime ? formatSimpleDate(lastUpdateTime) : '--';

  if (data.source === 'sample') {
    latestReadings.liveModeText.textContent = 'Demo mode';
    latestReadings.liveModeText.className = 'mini-badge warning';
  } else {
    latestReadings.liveModeText.textContent = 'Live data';
    latestReadings.liveModeText.className = 'mini-badge good';
  }

}

function updateNotifications(data) {
  const timestamp = formatSimpleDate(data.timestamp);
  const alerts = [];
  if (data.flow_mismatch) {
    alerts.push(`<div class="notification danger"><b>Flow sensors mismatch</b><span>${data.flow_mismatch_details}</span><time>${timestamp}</time></div>`);
  }
  if (data.ph === null || data.ph === undefined) {
    alerts.push(`<div class="notification warning"><b>pH reading unavailable</b><span>pH sensor is not providing a valid reading.</span><time>${timestamp}</time></div>`);
  }
  if (data.source !== 'esp32') {
    alerts.push(`<div class="notification info"><b>ESP32 disconnected</b><span>No live data received from ESP32.</span><time>${timestamp}</time></div>`);
  }
  if (!alerts.length) {
    alerts.push(`<div class="notification success"><b>All systems normal</b><span>Sensor readings are within the configured limits.</span><time>${timestamp}</time></div>`);
  }
  latestReadings.alertsList.innerHTML = alerts.join('');
  latestReadings.systemNotifications.innerHTML = [
    `<div><span class="dot success-dot"></span>Dashboard loaded <time>${timestamp}</time></div>`,
    `<div><span class="dot success-dot"></span>Sensor data updated <time>${timestamp}</time></div>`,
    `<div><span class="dot ${data.source === 'esp32' ? 'success-dot' : 'warning-dot'}"></span>ESP32 connection ${data.source === 'esp32' ? 'live' : 'lost'} <time>${timestamp}</time></div>`,
  ].join('');
}

async function sendTestEmail() {
  latestReadings.testEmailButton.disabled = true;
  latestReadings.testEmailButton.textContent = 'Sending...';
  latestReadings.testEmailMessage.textContent = '';
  latestReadings.testEmailMessage.className = 'test-email-message';
  try {
    const response = await fetch('/api/test-email', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || result.status !== 'success') {
      throw new Error(result.message || `Request failed: ${response.status}`);
    }
    latestReadings.testEmailMessage.textContent = `Success: ${result.message} to ${result.recipient}`;
    latestReadings.testEmailMessage.className = 'test-email-message success-message';
  } catch (error) {
    latestReadings.testEmailMessage.textContent = `Error: ${error.message}`;
    latestReadings.testEmailMessage.className = 'test-email-message error-message';
  } finally {
    latestReadings.testEmailButton.disabled = false;
    latestReadings.testEmailButton.textContent = 'Send Test Email';
  }
}

function updateLatestReadings(data) {
  applyMetricValue('phValue', data.ph, '', 2);
  applyMetricValue('turbidityValue', data.turbidity_raw_adc, '', 0);
  applyMetricValue('inletFlowValue', data.inlet_flow, '', 2);
  applyMetricValue('recoveryFlowValue', data.recovery_flow, '', 2);
  applyMetricValue('rejectFlowValue', data.reject_flow, '', 2);
  applyMetricValue('waterLevelValue', data.water_level, ' cm', 1);
  applyMetricValue('tankPercentageValue', data.tank_percentage, '%', 0);
  applyMetricValue('inletTotalValue', data.inlet_total_liters, ' L', 1);
  applyMetricValue('recoveryTotalValue', data.recovery_total_liters, ' L', 1);
  applyMetricValue('rejectTotalValue', data.reject_total_liters, ' L', 1);

  latestReadings.pumpStatus.textContent = data.pump_status || 'OFF';
  latestReadings.pumpStatus.style.color = data.pump_status === 'ON' ? '#41d67a' : '#ffc857';

  updateMetricTag('phLevel', data.ph === null ? null : Number(data.ph), { warning: 8.5, critical: 9.5 });
  updateMetricTag('turbidityLevel', data.turbidity_raw_adc === null ? null : Number(data.turbidity_raw_adc), { warning: 700, critical: 900 });
  updateSensorStatuses(data);
  latestReadings.flowMismatchAlert.hidden = !data.flow_mismatch;
  latestReadings.flowMismatchDetails.textContent = data.flow_mismatch
    ? data.flow_mismatch_details
    : '';

  const tankPercent = Number(data.tank_percentage || 0);
  latestReadings.tankFill.style.height = `${Math.max(0, Math.min(100, tankPercent))}%`;

  if (tankPercent < 20) {
    latestReadings.tankFill.style.background = 'linear-gradient(180deg, #ffb3b3, #ff5d73)';
  } else if (tankPercent < 60) {
    latestReadings.tankFill.style.background = 'linear-gradient(180deg, #ffd166, #ffc857)';
  } else {
    latestReadings.tankFill.style.background = 'linear-gradient(180deg, #56d1ff, #2ec4b6)';
  }

  updateSystemDisplay(data);
}

function buildSensorTable(data) {
  const statuses = data.sensor_status || {};
  const items = [
    ['pH', data.ph, 'pH', 'ph', data.timestamp],
    ['Turbidity raw reading', data.turbidity_raw_adc, 'ADC', 'turbidity', data.timestamp],
    ['Inlet flow', data.inlet_flow, 'L/min', 'inlet_flow', data.timestamp],
    ['Recovery flow', data.recovery_flow, 'L/min', 'recovery_flow', data.timestamp],
    ['Reject flow', data.reject_flow, 'L/min', 'reject_flow', data.timestamp],
    ['Water level', data.water_level, 'cm', 'water_level', data.timestamp],
    ['Tank level', data.tank_percentage, '%', 'water_level', data.timestamp],
    ['Pump status', data.pump_status, 'state', null, data.timestamp],
  ];

  latestReadings.tableBody.innerHTML = items
    .map(
      ([label, value, unit, sensor, timestamp]) => {
        const status = sensor ? (statuses[sensor] || 'unknown') : '';
        const statusLabel = {
          connected: 'Connected',
          unplugged: 'Unplugged',
          unknown: 'Unknown',
          not_configured: 'Not configured',
        }[status] || '';
        return `
        <tr>
          <td>${label}</td>
          <td>${value === null || value === undefined ? '--' : value}</td>
          <td>${unit}</td>
          <td>${statusLabel}</td>
          <td>${data.flow_mismatch ? data.flow_mismatch_details : 'Normal'}</td>
          <td>${timestamp ? formatSimpleDate(timestamp) : '--'}</td>
        </tr>
      `;
      },
    )
    .join('');
}

function getChartSeries(history, key, suffix = '') {
  return history.map((item) => Number(item[key] ?? 0)).slice(-12);
}

function drawLineChart(canvas, labels, datasets) {
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const padding = { top: 20, right: 20, bottom: 32, left: 42 };

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#edf4f8';
  ctx.fillRect(0, 0, width, height);

  if (!datasets.length || !labels.length) {
    ctx.fillStyle = '#a9c0d5';
    ctx.font = '14px Arial';
    ctx.fillText('No data available', 20, height / 2);
    return;
  }

  const allValues = datasets.flat();
  const maxValue = Math.max(...allValues, 1);
  const minValue = Math.min(...allValues, 0);
  const valueRange = Math.max(maxValue - minValue, 1);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + ((height - padding.top - padding.bottom) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  datasets.forEach((series, seriesIndex) => {
    const color = ['#2ec4b6', '#ffc857', '#ff5d73'][seriesIndex % 3];
    ctx.beginPath();
    series.forEach((value, index) => {
      const x = padding.left + ((width - padding.left - padding.right) / Math.max(labels.length - 1, 1)) * index;
      const normalized = (value - minValue) / valueRange;
      const y = height - padding.bottom - normalized * (height - padding.top - padding.bottom);

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  });

  ctx.fillStyle = '#a9c0d5';
  ctx.font = '12px Arial';
  for (let i = 0; i < labels.length; i += 1) {
    const x = padding.left + ((width - padding.left - padding.right) / Math.max(labels.length - 1, 1)) * i;
    ctx.fillText(labels[i], x - 12, height - 8);
  }
}

function updateCharts(history) {
  if (!history.length) return;

  const labels = history.map((row) => {
    const date = new Date(row.timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  const qualityData = [
    getChartSeries(history, 'ph'),
    getChartSeries(history, 'turbidity_raw_adc'),
  ];
  drawLineChart(qualityChartCtx, labels, qualityData);

  const flowData = [
    getChartSeries(history, 'inlet_flow'),
    getChartSeries(history, 'recovery_flow'),
    getChartSeries(history, 'reject_flow'),
  ];
  drawLineChart(flowChartCtx, labels, flowData);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function refreshDashboard() {
  try {
    const [latest, historyResponse] = await Promise.all([
      fetchJson('/api/latest'),
      fetchJson('/api/history'),
    ]);

    updateLatestReadings(latest);
    updateNotifications(latest);
    buildSensorTable(latest);
    updateCharts(historyResponse.data || []);
  } catch (error) {
    latestReadings.connectionBadge.textContent = 'Offline';
    latestReadings.connectionBadge.className = 'status-badge offline';
    latestReadings.esp32Status.textContent = 'Disconnected';
    latestReadings.lastUpdate.textContent = '--';
    latestReadings.sensorUpdateTime.textContent = '--';
    latestReadings.liveModeText.textContent = 'Connection issue';
    latestReadings.liveModeText.className = 'mini-badge warning';
    console.error('Dashboard refresh failed:', error);
  }
}

async function discoverEspDevices() {
  try {
    const response = await fetchJson('/api/discover');
    const device = response.devices && response.devices[0];
    if (device) {
      latestReadings.liveModeText.textContent = `ESP discovered: ${device.ip}`;
      latestReadings.liveModeText.className = 'mini-badge good';
    }
  } catch (error) {
    console.error('ESP discovery failed:', error);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  refreshDashboard();
  const refreshButton = document.getElementById('refreshButton');
  if (refreshButton) refreshButton.addEventListener('click', refreshDashboard);
  if (latestReadings.testEmailButton) {
    latestReadings.testEmailButton.addEventListener('click', sendTestEmail);
  }
  discoverEspDevices();
  window.setInterval(refreshDashboard, 4000);
  window.setInterval(discoverEspDevices, 30000);
});
