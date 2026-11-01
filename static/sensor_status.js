const sensors = [
  { key: 'ph', label: 'pH sensor (not connected)', unit: 'pH', valueId: 'phValue' },
  { key: 'turbidity', label: 'Turbidity sensor', unit: 'Raw ADC', valueId: 'turbidityValue' },
  { key: 'inlet_flow', label: 'Inlet flow sensor', unit: 'L/min', valueId: 'inletFlowValue' },
  { key: 'recovery_flow', label: 'Recovery flow sensor', unit: 'L/min', valueId: 'recoveryFlowValue' },
  { key: 'reject_flow', label: 'Reject flow sensor', unit: 'L/min', valueId: 'rejectFlowValue' },
  { key: 'water_level', label: 'Ultrasonic level sensor', unit: 'cm', valueId: 'waterLevelValue' },
];

const statusLabels = {
  connected: 'Connected',
  unplugged: 'Unplugged',
  unknown: 'Unknown',
  not_configured: 'Not configured',
  stale: 'ESP offline',
};

function formatValue(value) {
  return value === null || value === undefined ? '--' : value;
}

function formatTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString();
}

function renderStatus(data) {
  const timestamp = data.timestamp ? new Date(data.timestamp) : null;
  const isLive = data.source === 'esp32' && timestamp && (Date.now() - timestamp.getTime()) <= 15000;
  const statuses = data.sensor_status || {};
  const effectiveStatuses = {};

  sensors.forEach((sensor) => {
    const status = isLive
      ? (statuses[sensor.key] || 'unknown')
      : 'stale';
    effectiveStatuses[sensor.key] = status;

    const cardStatus = document.getElementById(`${sensor.key}Status`);
    const valueElement = document.getElementById(sensor.valueId);
    if (cardStatus) {
      cardStatus.textContent = statusLabels[status] || 'Unknown';
      cardStatus.className = `sensor-status-badge ${status}`;
    }
    if (valueElement) {
      const value = sensor.key === 'turbidity'
        ? data.turbidity_raw_adc
        : data[sensor.key];
      valueElement.textContent = formatValue(value);
    }
  });

  const modeBadge = document.getElementById('statusModeBadge');
  modeBadge.textContent = isLive ? 'ESP connected' : data.source === 'sample' ? 'Demo data' : 'ESP offline';
  modeBadge.className = `status-badge ${isLive ? 'online' : 'offline'}`;
  document.getElementById('statusUpdateTime').textContent = formatTime(data.timestamp);

  const connected = Object.values(effectiveStatuses).filter((status) => status === 'connected').length;
  document.getElementById('sensorCountText').textContent = `${connected}/${sensors.length} connected`;

  document.getElementById('statusTableBody').innerHTML = sensors.map((sensor) => {
    const status = effectiveStatuses[sensor.key];
    return `
      <tr>
        <td>${sensor.label}</td>
        <td><span class="sensor-status-badge ${status}">${statusLabels[status] || 'Unknown'}</span></td>
        <td>${formatValue(sensor.key === 'turbidity' ? data.turbidity_raw_adc : data[sensor.key])}</td>
        <td>${sensor.unit}</td>
        <td>${formatTime(data.timestamp)}</td>
      </tr>
    `;
  }).join('');
}

async function refreshSensorStatus() {
  try {
    const response = await fetch('/api/latest');
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    renderStatus(await response.json());
  } catch (error) {
    document.getElementById('statusModeBadge').textContent = 'Backend offline';
    document.getElementById('statusModeBadge').className = 'status-badge offline';
    console.error('Sensor status refresh failed:', error);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  refreshSensorStatus();
  window.setInterval(refreshSensorStatus, 4000);
});
