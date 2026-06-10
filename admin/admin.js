// Admin Dashboard JavaScript
let socket;
let currentSection = 'overview';
let currentLogFilter = 'all';
let currentLogTab = 'system';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  console.log('Admin dashboard loading...');
  
  // Check authentication
  checkAuth();
  
  // Initialize Socket.IO
  initializeSocket();
  
  // Initialize event listeners
  initializeEventListeners();
  
  // Load initial data
  loadDashboardStats();
  
  console.log('Admin dashboard initialized');
});

// Check Authentication
async function checkAuth() {
  try {
    const response = await fetch('/auth/check-session');
    const data = await response.json();
    
    if (!data.authenticated || data.user.role !== 'admin') {
      window.location.href = '/';
      return;
    }
    
    document.getElementById('adminName').textContent = data.user.email;
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
  });
  
  socket.on('arduino-status', (data) => {
    updateArduinoStatus(data);
  });
  
  socket.on('arduino-response', (data) => {
    console.log('[Arduino Response]:', data.response);
    
    // Update device monitoring if on device section
    if (currentSection === 'device') {
      const lastResponseSpan = document.getElementById('deviceLastResponse');
      if (lastResponseSpan) {
        lastResponseSpan.textContent = data.response + ' at ' + new Date().toLocaleTimeString();
      }
    }
  });
  
  socket.on('arduino-error', (data) => {
    console.error('[Arduino Error]:', data.error);
    showToast(`Arduino Error: ${data.error}`, 'error');
  });
  
  socket.on('user-created', () => {
    loadUsers();
    loadDashboardStats();
  });
  
  socket.on('user-updated', () => {
    loadUsers();
  });
  
  socket.on('user-deleted', () => {
    loadUsers();
    loadDashboardStats();
  });
  
  socket.on('dispense-complete', () => {
    loadDashboardStats();
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
  
  // Logout
  document.getElementById('btnLogout').addEventListener('click', logout);
  
  // Add User Button
  document.getElementById('btnAddUser').addEventListener('click', () => {
    openUserModal();
  });
  
  // User Form
  document.getElementById('userForm').addEventListener('submit', saveUser);
  
  // Password Form
  document.getElementById('passwordForm').addEventListener('submit', resetPassword);
  
  // Settings Form
  document.getElementById('settingsForm').addEventListener('submit', saveSettings);
  
  // Modal Close Buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', closeModals);
  });
  
  // Tab Buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchLogTab(tab);
    });
  });
  
  // Log Filter Buttons
  document.querySelectorAll('.filter-buttons .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter;
      setLogFilter(filter);
    });
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
  
  // Load section data
  switch(section) {
    case 'overview':
      loadDashboardStats();
      break;
    case 'users':
      loadUsers();
      break;
    case 'logs':
      loadLogs();
      break;
    case 'device':
      loadDeviceStatus();
      break;
    case 'settings':
      loadSettings();
      break;
  }
}

// Load Dashboard Stats
async function loadDashboardStats() {
  try {
    const response = await fetch('/admin/stats');
    const data = await response.json();
    
    if (data.success) {
      const stats = data.stats;
      document.getElementById('totalUsers').textContent = stats.totalUsers || 0;
      document.getElementById('activeUsers').textContent = stats.activeUsers || 0;
      document.getElementById('disabledUsers').textContent = stats.disabledUsers || 0;
      document.getElementById('totalFeedings').textContent = stats.totalFeedingsToday || 0;
      document.getElementById('foodDispensed').textContent = stats.foodDispensedToday || 0;
      document.getElementById('waterDispensed').textContent = stats.waterDispensedToday || 0;
      document.getElementById('activeSchedules').textContent = stats.activeSchedules || 0;
      
      const arduinoStatus = stats.arduinoStatus || 'offline';
      const arduinoIcon = document.getElementById('arduinoIcon');
      const arduinoText = document.getElementById('arduinoStatus');
      
      if (arduinoStatus === 'online') {
        arduinoIcon.textContent = '🟢';
        arduinoText.textContent = 'Online';
      } else {
        arduinoIcon.textContent = '🔴';
        arduinoText.textContent = 'Offline';
      }
    }
  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

// Load Users
async function loadUsers() {
  try {
    const response = await fetch('/admin/users');
    const data = await response.json();
    
    if (data.success) {
      const tbody = document.getElementById('usersTableBody');
      tbody.innerHTML = '';
      
      if (data.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No users found</td></tr>';
        return;
      }
      
      data.users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${user.id}</td>
          <td>${user.email}</td>
          <td>${user.pet_name || 'N/A'}</td>
          <td>${user.pet_type || 'N/A'}</td>
          <td>${new Date(user.created_at).toLocaleDateString()}</td>
          <td><span class="badge ${user.is_active ? 'badge-active' : 'badge-inactive'}">${user.is_active ? 'Active' : 'Disabled'}</span></td>
          <td class="action-buttons">
            <button class="btn btn-sm btn-warning" onclick="editUser(${user.id})">Edit</button>
            <button class="btn btn-sm ${user.is_active ? 'btn-secondary' : 'btn-success'}" onclick="toggleUserStatus(${user.id}, ${!user.is_active})">${user.is_active ? 'Disable' : 'Enable'}</button>
            <button class="btn btn-sm btn-warning" onclick="openPasswordModal(${user.id})">Reset PW</button>
            <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id})">Delete</button>
          </td>
        `;
        tbody.appendChild(row);
      });
    }
  } catch (error) {
    console.error('Error loading users:', error);
    showToast('Error loading users', 'error');
  }
}

// Open User Modal
function openUserModal(user = null) {
  const modal = document.getElementById('userModal');
  const title = document.getElementById('userModalTitle');
  const form = document.getElementById('userForm');
  const passwordGroup = document.getElementById('passwordGroup');
  
  form.reset();
  
  if (user) {
    title.textContent = 'Edit User';
    document.getElementById('userId').value = user.id;
    document.getElementById('userEmail').value = user.email;
    document.getElementById('petName').value = user.pet_name || '';
    document.getElementById('petType').value = user.pet_type || '';
    document.getElementById('petAge').value = user.pet_age || '';
    document.getElementById('petWeight').value = user.pet_weight || '';
    passwordGroup.style.display = 'none';
    document.getElementById('userPassword').removeAttribute('required');
  } else {
    title.textContent = 'Add New User';
    document.getElementById('userId').value = '';
    passwordGroup.style.display = 'block';
    document.getElementById('userPassword').setAttribute('required', '');
  }
  
  modal.classList.add('show');
}

// Save User
async function saveUser(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const userId = document.getElementById('userId').value;
  const data = {
    email: formData.get('email'),
    password: formData.get('password'),
    pet_name: formData.get('pet_name'),
    pet_type: formData.get('pet_type'),
    pet_age: formData.get('pet_age'),
    pet_weight: formData.get('pet_weight')
  };
  
  try {
    const url = userId ? `/admin/users/${userId}` : '/admin/users';
    const method = userId ? 'PUT' : 'POST';
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(result.message, 'success');
      closeModals();
      loadUsers();
      loadDashboardStats();
    } else {
      showToast(result.message, 'error');
    }
  } catch (error) {
    console.error('Error saving user:', error);
    showToast('Error saving user', 'error');
  }
}

// Edit User
async function editUser(userId) {
  try {
    const response = await fetch('/admin/users');
    const data = await response.json();
    
    if (data.success) {
      const user = data.users.find(u => u.id === userId);
      if (user) {
        openUserModal(user);
      }
    }
  } catch (error) {
    console.error('Error fetching user:', error);
  }
}

// Toggle User Status
async function toggleUserStatus(userId, isActive) {
  if (!confirm(`Are you sure you want to ${isActive ? 'enable' : 'disable'} this user?`)) {
    return;
  }
  
  try {
    const response = await fetch(`/admin/users/${userId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: isActive })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(result.message, 'success');
      loadUsers();
      loadDashboardStats();
    } else {
      showToast(result.message, 'error');
    }
  } catch (error) {
    console.error('Error toggling user status:', error);
    showToast('Error updating user status', 'error');
  }
}

// Open Password Modal
function openPasswordModal(userId) {
  document.getElementById('resetUserId').value = userId;
  document.getElementById('passwordForm').reset();
  document.getElementById('passwordModal').classList.add('show');
}

// Reset Password
async function resetPassword(e) {
  e.preventDefault();
  
  const userId = document.getElementById('resetUserId').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  
  if (newPassword !== confirmPassword) {
    showToast('Passwords do not match', 'error');
    return;
  }
  
  try {
    const response = await fetch(`/admin/users/${userId}/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: newPassword })
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(result.message, 'success');
      closeModals();
    } else {
      showToast(result.message, 'error');
    }
  } catch (error) {
    console.error('Error resetting password:', error);
    showToast('Error resetting password', 'error');
  }
}

// Delete User
async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user? This action cannot be undone and will delete all user data including schedules and logs.')) {
    return;
  }
  
  try {
    const response = await fetch(`/admin/users/${userId}`, {
      method: 'DELETE'
    });
    
    const result = await response.json();
    
    if (result.success) {
      showToast(result.message, 'success');
      loadUsers();
      loadDashboardStats();
    } else {
      showToast(result.message, 'error');
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    showToast('Error deleting user', 'error');
  }
}

// Load Logs
async function loadLogs() {
  if (currentLogTab === 'system') {
    loadSystemLogs();
  } else {
    loadFeedingLogs();
  }
}

// Load System Logs
async function loadSystemLogs() {
  try {
    const filter = currentLogFilter === 'all' ? '' : currentLogFilter;
    const response = await fetch(`/admin/logs?filter=${filter}`);
    const data = await response.json();
    
    if (data.success) {
      const tbody = document.getElementById('systemLogsBody');
      tbody.innerHTML = '';
      
      if (data.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No logs found</td></tr>';
        return;
      }
      
      data.logs.forEach(log => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${log.id}</td>
          <td>${log.log_type}</td>
          <td>${log.message}</td>
          <td>${new Date(log.created_at).toLocaleString()}</td>
        `;
        tbody.appendChild(row);
      });
    }
  } catch (error) {
    console.error('Error loading system logs:', error);
  }
}

// Load Feeding Logs
async function loadFeedingLogs() {
  try {
    const filter = currentLogFilter === 'all' ? '' : currentLogFilter;
    const response = await fetch(`/admin/feeding-logs?filter=${filter}`);
    const data = await response.json();
    
    if (data.success) {
      const tbody = document.getElementById('feedingLogsBody');
      tbody.innerHTML = '';
      
      if (data.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No logs found</td></tr>';
        return;
      }
      
      data.logs.forEach(log => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${log.id}</td>
          <td>${log.email || 'N/A'}</td>
          <td>${log.pet_name || 'N/A'}</td>
          <td>${log.dispense_type}</td>
          <td>${log.source}</td>
          <td><span class="badge ${log.status === 'success' ? 'badge-active' : 'badge-inactive'}">${log.status}</span></td>
          <td>${new Date(log.timestamp).toLocaleString()}</td>
        `;
        tbody.appendChild(row);
      });
    }
  } catch (error) {
    console.error('Error loading feeding logs:', error);
  }
}

// Switch Log Tab
function switchLogTab(tab) {
  currentLogTab = tab;
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tab}-logs`).classList.add('active');
  
  loadLogs();
}

// Set Log Filter
function setLogFilter(filter) {
  currentLogFilter = filter;
  
  document.querySelectorAll('.filter-buttons .btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`[data-filter="${filter}"]`).classList.add('active');
  
  loadLogs();
}

// Load Device Status
async function loadDeviceStatus() {
  try {
    const response = await fetch('/admin/device-status');
    const data = await response.json();
    
    if (data.success && data.status) {
      updateArduinoStatus({
        status: data.status.arduino_status,
        lastResponse: data.status.last_heartbeat
      });
    }
  } catch (error) {
    console.error('Error loading device status:', error);
  }
}

// Update Arduino Status
function updateArduinoStatus(data) {
  const statusDiv = document.getElementById('deviceArduinoStatus');
  const portSpan = document.getElementById('devicePort');
  const lastResponseSpan = document.getElementById('deviceLastResponse');
  
  if (statusDiv) {
    const isOnline = data.status === 'online';
    statusDiv.innerHTML = `
      <span class="status-indicator ${isOnline ? 'online' : 'offline'}"></span>
      <span class="status-text">${isOnline ? 'Online' : 'Offline'}</span>
    `;
  }
  
  if (portSpan && data.port) {
    portSpan.textContent = data.port;
  }
  
  if (lastResponseSpan && data.lastResponse) {
    lastResponseSpan.textContent = new Date(data.lastResponse).toLocaleString();
  }
}

// Load Settings
async function loadSettings() {
  try {
    const response = await fetch('/admin/settings');
    const data = await response.json();
    
    if (data.success) {
      document.getElementById('feedDuration').value = data.settings.feed_duration || 3000;
      document.getElementById('pumpDuration').value = data.settings.pump_duration || 5000;
      document.getElementById('notificationEnabled').checked = data.settings.notification_enabled === '1';
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Save Settings
async function saveSettings(e) {
  e.preventDefault();
  
  const data = {
    feed_duration: document.getElementById('feedDuration').value,
    pump_duration: document.getElementById('pumpDuration').value,
    notification_enabled: document.getElementById('notificationEnabled').checked ? '1' : '0'
  };
  
  try {
    const response = await fetch('/admin/settings', {
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
    console.error('Error saving settings:', error);
    showToast('Error saving settings', 'error');
  }
}

// Close Modals
function closeModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.remove('show');
  });
}

// Logout
async function logout() {
  if (!confirm('Are you sure you want to logout?')) {
    return;
  }
  
  try {
    const response = await fetch('/auth/logout', { method: 'POST' });
    const data = await response.json();
    
    if (data.success) {
      window.location.href = '/';
    }
  } catch (error) {
    console.error('Logout error:', error);
    window.location.href = '/';
  }
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

// Auto refresh stats every 30 seconds
setInterval(() => {
  if (currentSection === 'overview') {
    loadDashboardStats();
  }
}, 30000);
