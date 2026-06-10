// User Dashboard JavaScript
let socket;
let currentSection = 'home';
let currentFilter = '';
let cooldownTimer = null;
let cooldownSeconds = 0;
let confirmCallback = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  console.log('User dashboard loading...');
  
  // Check authentication
  checkAuth();
  
  // Initialize Socket.IO
  initializeSocket();
  
  // Initialize event listeners
  initializeEventListeners();
  
  // Load initial data
  loadDashboard();
  
  // Apply saved theme
  applySavedTheme();
  
  console.log('User dashboard initialized');
});

// Check Authentication
async function checkAuth() {
  try {
    const response = await fetch('/auth/check-session');
    const data = await response.json();
    
    if (!data.authenticated) {
      window.location.href = '/';
      return;
    }
    
    if (data.user.role === 'admin') {
      window.location.href = '/admin/admin.html';
      return;
    }
    
    document.getElementById('userEmail').textContent = data.user.email;
    if (data.user.pet_name) {
      document.getElementById('petNameTitle').textContent = data.user.pet_name;
    }
  } catch (error) {
    console.error('Auth check error:', error);
    window.location.href = '/';
  }
}

// Initialize Socket.IO
function initializeSocket() {
  socket = io();
  
  socket.on('connect', () => {
    console.log('Socket.IO connected');
    updateConnectionStatus(true);
  });
  
  socket.on('disconnect', () => {
    console.log('Socket.IO disconnected');
    updateConnectionStatus(false);
  });
  
  socket.on('arduino-status', (data) => {
    updateArduinoStatus(data.status);
  });
  
  socket.on('dispense-complete', (data) => {
    handleDispenseComplete(data);
  });
  
  socket.on('arduino-response', (data) => {
    console.log('[Arduino Response]:', data.response);
    
    // Update feed status if on feed control page
    if (currentSection === 'feed' && data.response) {
      const statusDiv = document.getElementById('feedStatus');
      if (statusDiv) {
        statusDiv.innerHTML = `
          <div style="color: var(--text-light); font-size: 14px;">
            <strong>Arduino:</strong> ${data.response}
          </div>
        `;
      }
    }
  });
  
  socket.on('arduino-error', (data) => {
    console.error('[Arduino Error]:', data.error);
    showToast(`Arduino Error: ${data.error}`, 'error');
  });
  
  socket.on('arduino-schedules', (data) => {
    console.log('[Arduino] Schedules:', data.count);
  });
  
  socket.on('schedule-created', () => {
    if (currentSection === 'schedule') {
      loadSchedules();
    }
    loadDashboard();
  });
  
  socket.on('schedule-updated', () => {
    if (currentSection === 'schedule') {
      loadSchedules();
    }
  });
  
  socket.on('schedule-deleted', () => {
    if (currentSection === 'schedule') {
      loadSchedules();
    }
    loadDashboard();
  });
  
  // Listen for feeding logs (real-time history update)
  socket.on('feeding-logged', (data) => {
    console.log('[Feeding Logged]:', data);
    
    // Refresh dashboard to show latest feeding
    if (currentSection === 'home') {
      loadDashboard();
    }
    
    // Refresh history if on history page
    if (currentSection === 'history') {
      loadHistory();
    }
  });
}

// Initialize Event Listeners
function initializeEventListeners() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;
      switchSection(section);
    });
  });
  
  // Mobile menu toggle
  document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('active');
  });
  
  // Logout
  document.getElementById('btnLogout').addEventListener('click', logout);
  
  // Feed buttons
  document.getElementById('btnFood').addEventListener('click', () => dispense('food'));
  document.getElementById('btnWater').addEventListener('click', () => dispense('water'));
  document.getElementById('btnBoth').addEventListener('click', () => dispense('both'));
  
  // Schedule
  document.getElementById('btnAddSchedule').addEventListener('click', () => openScheduleModal());
  document.getElementById('scheduleForm').addEventListener('submit', saveSchedule);
  
  // History filter
  document.querySelectorAll('.filter-buttons .btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      setHistoryFilter(e.target.dataset.filter);
    });
  });
  
  // Export CSV
  document.getElementById('btnExport').addEventListener('click', exportCSV);
  
  // Profile form
  document.getElementById('profileForm').addEventListener('submit', saveProfile);
  
  // Password form
  document.getElementById('passwordForm').addEventListener('submit', changePassword);
  
  // Preferences form
  document.getElementById('preferencesForm').addEventListener('submit', savePreferences);
  
  // Theme change
  document.getElementById('themeSelect').addEventListener('change', (e) => {
    applyTheme(e.target.value);
  });
  
  // Modal close
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeModals);
  });
  
  // Confirm button
  document.getElementById('confirmBtn').addEventListener('click', () => {
    if (confirmCallback) {
      confirmCallback();
      closeModals();
    }
  });
}

// Switch Section
function switchSection(section) {
  currentSection = section;
  
  // Update navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  document.querySelector(`[data-section="${section}"]`).classList.add('active');
  
  // Update content
  document.querySelectorAll('.section').forEach(sec => {
    sec.classList.remove('active');
  });
  document.getElementById(`${section}-section`).classList.add('active');
  
  // Close mobile menu
  document.getElementById('sidebar').classList.remove('active');
  
  // Load section data
  switch(section) {
    case 'home':
      loadDashboard();
      break;
    case 'schedule':
      loadSchedules();
      break;
    case 'history':
      loadHistory();
      break;
    case 'profile':
      loadProfile();
      break;
    case 'settings':
      loadSettings();
      break;
  }
}

// Load Dashboard
async function loadDashboard() {
  try {
    const response = await fetch('/user/dashboard');
    const data = await response.json();
    
    if (data.success) {
      // Update pet info
      if (data.profile) {
        document.getElementById('dashPetName').textContent = data.profile.pet_name || 'My Pet';
        document.getElementById('dashPetType').textContent = data.profile.pet_type || 'Pet';
      }
      
      // Last feeding
      if (data.lastFeeding) {
        const feedTime = new Date(data.lastFeeding.timestamp);
        document.getElementById('lastFeeding').textContent = formatTime(feedTime);
        
        if (data.lastFeeding.dispense_type === 'water' || data.lastFeeding.dispense_type === 'both') {
          document.getElementById('lastWater').textContent = formatTime(feedTime);
        }
      }
      
      // Next schedule
      if (data.nextSchedule) {
        const scheduleText = `${data.nextSchedule.hour}:${String(data.nextSchedule.minute).padStart(2, '0')} ${data.nextSchedule.ampm} - ${data.nextSchedule.dispense_type}`;
        document.getElementById('nextSchedule').textContent = scheduleText;
      } else {
        document.getElementById('nextSchedule').textContent = 'No schedules';
      }
      
      // Arduino status
      if (data.deviceStatus) {
        updateArduinoStatus(data.deviceStatus.arduino_status);
      }
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

// Dispense Function
function dispense(type) {
  const typeNames = {
    food: 'Food Only',
    water: 'Water Only',
    both: 'Food and Water'
  };
  
  showConfirm(
    'Confirm Dispense',
    `Are you sure you want to dispense ${typeNames[type]}?`,
    async () => {
      try {
        const response = await fetch(`/api/dispense/${type}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();
        
        if (result.success) {
          showToast(result.message, 'success');
          document.getElementById('feedStatus').innerHTML = `
            <div style="color: var(--primary-color); font-weight: 600;">
              ⏳ ${typeNames[type]} dispensing in progress...
            </div>
          `;
          
          // Start cooldown
          startCooldown();
          
          // Disable all feed buttons
          disableFeedButtons(true);
        } else {
          showToast(result.message, 'error');
        }
      } catch (error) {
        console.error('Dispense error:', error);
        showToast('Failed to send command. Please try again.', 'error');
      }
    }
  );
}

// Handle Dispense Complete
function handleDispenseComplete(data) {
  const typeNames = {
    food: 'Food',
    water: 'Water',
    both: 'Food and Water'
  };
  
  const statusColor = data.status === 'success' ? 'var(--success-color)' : 'var(--danger-color)';
  const statusIcon = data.status === 'success' ? '✅' : '❌';
  const statusText = data.status === 'success' ? 'completed successfully!' : 'failed!';
  
  document.getElementById('feedStatus').innerHTML = `
    <div style="color: ${statusColor}; font-weight: 600;">
      ${statusIcon} ${typeNames[data.type]} dispensing ${statusText}
    </div>
  `;
  
  if (data.status === 'success') {
    showToast(`${typeNames[data.type]} dispensed successfully!`, 'success');
  } else {
    showToast(`Failed to dispense ${typeNames[data.type]}`, 'error');
  }
  
  // Reload dashboard to update last feeding
  if (currentSection === 'home') {
    setTimeout(() => loadDashboard(), 1000);
  }
  
  // Reload history if on history page
  if (currentSection === 'history') {
    setTimeout(() => loadHistory(), 1000);
  }
}

// Cooldown Timer
function startCooldown() {
  cooldownSeconds = 10;
  document.getElementById('cooldownMessage').style.display = 'block';
  document.getElementById('cooldownTimer').textContent = cooldownSeconds;
  
  cooldownTimer = setInterval(() => {
    cooldownSeconds--;
    document.getElementById('cooldownTimer').textContent = cooldownSeconds;
    
    if (cooldownSeconds <= 0) {
      clearInterval(cooldownTimer);
      document.getElementById('cooldownMessage').style.display = 'none';
      disableFeedButtons(false);
    }
  }, 1000);
}

// Disable/Enable Feed Buttons
function disableFeedButtons(disable) {
  document.getElementById('btnFood').disabled = disable;
  document.getElementById('btnWater').disabled = disable;
  document.getElementById('btnBoth').disabled = disable;
}

// Load Schedules
async function loadSchedules() {
  try {
    const response = await fetch('/user/schedules');
    const data = await response.json();
    
    if (data.success) {
      const container = document.getElementById('schedulesContainer');
      container.innerHTML = '';
      
      if (data.schedules.length === 0) {
        container.innerHTML = '<p class="loading-text">No schedules found. Add one to get started!</p>';
        return;
      }
      
      data.schedules.forEach(schedule => {
        const card = createScheduleCard(schedule);
        container.appendChild(card);
      });
    }
  } catch (error) {
    console.error('Error loading schedules:', error);
    showToast('Error loading schedules', 'error');
  }
}

// Create Schedule Card
function createScheduleCard(schedule) {
  const div = document.createElement('div');
  div.className = `schedule-card ${schedule.is_active ? '' : 'inactive'}`;
  
  const timeStr = `${schedule.hour}:${String(schedule.minute).padStart(2, '0')} ${schedule.ampm}`;
  
  div.innerHTML = `
    <div class="schedule-header">
      <div class="schedule-time">${timeStr}</div>
      <div class="schedule-actions">
        <button class="icon-btn" onclick="editSchedule(${schedule.id})" title="Edit">✏️</button>
        <button class="icon-btn" onclick="toggleSchedule(${schedule.id}, ${!schedule.is_active})" title="${schedule.is_active ? 'Disable' : 'Enable'}">${schedule.is_active ? '⏸️' : '▶️'}</button>
        <button class="icon-btn" onclick="deleteSchedule(${schedule.id})" title="Delete">🗑️</button>
      </div>
    </div>
    <span class="schedule-type ${schedule.dispense_type}">${schedule.dispense_type === 'both' ? 'Food + Water' : schedule.dispense_type}</span>
  `;
  
  return div;
}

// Open Schedule Modal
function openScheduleModal(schedule = null) {
  const modal = document.getElementById('scheduleModal');
  const title = document.getElementById('scheduleModalTitle');
  const form = document.getElementById('scheduleForm');
  
  form.reset();
  
  if (schedule) {
    title.textContent = 'Edit Schedule';
    document.getElementById('scheduleId').value = schedule.id;
    document.getElementById('scheduleHour').value = schedule.hour;
    document.getElementById('scheduleMinute').value = schedule.minute;
    document.getElementById('scheduleAmPm').value = schedule.ampm;
    document.getElementById('scheduleType').value = schedule.dispense_type;
  } else {
    title.textContent = 'Add Schedule';
    document.getElementById('scheduleId').value = '';
  }
  
  modal.classList.add('show');
}

// Save Schedule
async function saveSchedule(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const scheduleId = document.getElementById('scheduleId').value;
  
  const data = {
    hour: parseInt(formData.get('hour')),
    minute: parseInt(formData.get('minute')),
    ampm: formData.get('ampm'),
    dispense_type: formData.get('dispense_type')
  };
  
  // Validation
  if (data.hour < 1 || data.hour > 12) {
    showToast('Hour must be between 1 and 12', 'error');
    return;
  }
  
  if (data.minute < 0 || data.minute > 59) {
    showToast('Minute must be between 0 and 59', 'error');
    return;
  }
  
  try {
    const url = scheduleId ? `/user/schedules/${scheduleId}` : '/user/schedules';
    const method = scheduleId ? 'PUT' : 'POST';
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(result.message, 'success');
      closeModals();
      loadSchedules();
      loadDashboard();
    } else {
      showToast(result.message, 'error');
    }
  } catch (error) {
    console.error('Error saving schedule:', error);
    showToast('Error saving schedule', 'error');
  }
}

// Edit Schedule
async function editSchedule(scheduleId) {
  try {
    const response = await fetch('/user/schedules');
    const data = await response.json();
    
    if (data.success) {
      const schedule = data.schedules.find(s => s.id === scheduleId);
      if (schedule) {
        openScheduleModal(schedule);
      }
    }
  } catch (error) {
    console.error('Error fetching schedule:', error);
  }
}

// Toggle Schedule
async function toggleSchedule(scheduleId, isActive) {
  try {
    const response = await fetch(`/user/schedules/${scheduleId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: isActive })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(result.message, 'success');
      loadSchedules();
    } else {
      showToast(result.message, 'error');
    }
  } catch (error) {
    console.error('Error toggling schedule:', error);
    showToast('Error updating schedule', 'error');
  }
}

// Delete Schedule
function deleteSchedule(scheduleId) {
  showConfirm(
    'Delete Schedule',
    'Are you sure you want to delete this schedule?',
    async () => {
      try {
        const response = await fetch(`/user/schedules/${scheduleId}`, {
          method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
          showToast(result.message, 'success');
          loadSchedules();
          loadDashboard();
        } else {
          showToast(result.message, 'error');
        }
      } catch (error) {
        console.error('Error deleting schedule:', error);
        showToast('Error deleting schedule', 'error');
      }
    }
  );
}

// Load History
async function loadHistory() {
  try {
    const response = await fetch(`/user/feeding-history?filter=${currentFilter}`);
    const data = await response.json();
    
    if (data.success) {
      const tbody = document.getElementById('historyTableBody');
      tbody.innerHTML = '';
      
      if (data.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No history found</td></tr>';
        return;
      }
      
      data.logs.forEach(log => {
        const date = new Date(log.timestamp);
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${date.toLocaleDateString()}</td>
          <td>${date.toLocaleTimeString()}</td>
          <td>${log.dispense_type}</td>
          <td><span class="badge badge-${log.source}">${log.source}</span></td>
          <td><span class="badge badge-${log.status}">${log.status}</span></td>
        `;
        tbody.appendChild(row);
      });
    }
  } catch (error) {
    console.error('Error loading history:', error);
    showToast('Error loading history', 'error');
  }
}

// Set History Filter
function setHistoryFilter(filter) {
  currentFilter = filter;
  
  document.querySelectorAll('.filter-buttons .btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.filter === filter) {
      btn.classList.add('active');
    }
  });
  
  loadHistory();
}

// Export CSV
async function exportCSV() {
  try {
    const response = await fetch(`/user/feeding-history?filter=${currentFilter}`);
    const data = await response.json();
    
    if (!data.success || data.logs.length === 0) {
      showToast('No data to export', 'info');
      return;
    }
    
    // Create CSV content
    let csv = 'Date,Time,Type,Source,Status\n';
    data.logs.forEach(log => {
      const date = new Date(log.timestamp);
      csv += `${date.toLocaleDateString()},${date.toLocaleTimeString()},${log.dispense_type},${log.source},${log.status}\n`;
    });
    
    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feeding-history-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    
    showToast('CSV exported successfully', 'success');
  } catch (error) {
    console.error('Error exporting CSV:', error);
    showToast('Error exporting CSV', 'error');
  }
}

// Load Profile
async function loadProfile() {
  try {
    const response = await fetch('/user/dashboard');
    const data = await response.json();
    
    if (data.success && data.profile) {
      document.getElementById('profilePetName').value = data.profile.pet_name || '';
      document.getElementById('profilePetType').value = data.profile.pet_type || '';
      document.getElementById('profilePetAge').value = data.profile.pet_age || '';
      document.getElementById('profilePetWeight').value = data.profile.pet_weight || '';
    }
  } catch (error) {
    console.error('Error loading profile:', error);
  }
}

// Save Profile
async function saveProfile(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const data = {
    pet_name: formData.get('pet_name'),
    pet_type: formData.get('pet_type'),
    pet_age: formData.get('pet_age'),
    pet_weight: formData.get('pet_weight')
  };
  
  try {
    const response = await fetch('/user/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(result.message, 'success');
      document.getElementById('petNameTitle').textContent = data.pet_name || 'Pet Feeder';
      loadDashboard();
    } else {
      showToast(result.message, 'error');
    }
  } catch (error) {
    console.error('Error saving profile:', error);
    showToast('Error saving profile', 'error');
  }
}

// Load Settings
async function loadSettings() {
  try {
    const response = await fetch('/user/settings');
    const data = await response.json();
    
    if (data.success && data.settings) {
      document.getElementById('notificationsEnabled').checked = data.settings.notifications_enabled === 1;
      document.getElementById('themeSelect').value = data.settings.theme || 'light';
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Change Password
async function changePassword(e) {
  e.preventDefault();
  
  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  
  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match', 'error');
    return;
  }
  
  if (newPassword.length < 6) {
    showToast('Password must be at least 6 characters', 'error');
    return;
  }
  
  try {
    const response = await fetch('/user/change-password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(result.message, 'success');
      document.getElementById('passwordForm').reset();
    } else {
      showToast(result.message, 'error');
    }
  } catch (error) {
    console.error('Error changing password:', error);
    showToast('Error changing password', 'error');
  }
}

// Save Preferences
async function savePreferences(e) {
  e.preventDefault();
  
  const data = {
    notifications_enabled: document.getElementById('notificationsEnabled').checked,
    theme: document.getElementById('themeSelect').value
  };
  
  try {
    const response = await fetch('/user/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(result.message, 'success');
    } else {
      showToast(result.message, 'error');
    }
  } catch (error) {
    console.error('Error saving preferences:', error);
    showToast('Error saving preferences', 'error');
  }
}

// Theme Functions
function applyTheme(theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
  }
  localStorage.setItem('theme', theme);
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  applyTheme(savedTheme);
  document.getElementById('themeSelect').value = savedTheme;
}

// Update Arduino Status
function updateArduinoStatus(status) {
  const statusDiv = document.getElementById('arduinoStatus');
  if (statusDiv) {
    const isOnline = status === 'online';
    statusDiv.innerHTML = `
      <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
      <span>${isOnline ? 'Online' : 'Offline'}</span>
    `;
  }
}

// Update Connection Status
function updateConnectionStatus(connected) {
  const statusDiv = document.getElementById('connectionStatus');
  if (statusDiv) {
    statusDiv.innerHTML = `
      <span class="status-dot ${connected ? 'online' : 'offline'}"></span>
      <span>${connected ? 'Connected' : 'Disconnected'}</span>
    `;
  }
}

// Show Confirm Modal
function showConfirm(title, message, callback) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  confirmCallback = callback;
  document.getElementById('confirmModal').classList.add('show');
}

// Close Modals
function closeModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.remove('show');
  });
  confirmCallback = null;
}

// Logout
async function logout() {
  showConfirm(
    'Logout',
    'Are you sure you want to logout?',
    async () => {
      try {
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/';
      } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/';
      }
    }
  );
}

// Show Toast
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Format Time
function formatTime(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  
  return date.toLocaleDateString();
}

// Auto refresh dashboard every 30 seconds
setInterval(() => {
  if (currentSection === 'home') {
    loadDashboard();
  }
}, 30000);
