/*
 * Admin Routes
 * Handles admin-specific operations
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/adminMiddleware');

// Apply middleware to all admin routes
router.use(requireAuth);
router.use(requireAdmin);

// Get Dashboard Statistics
router.get('/stats', (req, res) => {
  const db = req.app.locals.db;
  const stats = {};

  // Total users
  db.get('SELECT COUNT(*) as total FROM users WHERE role = "user"', (err, row) => {
    if (err) return res.json({ success: false, message: 'Database error' });
    stats.totalUsers = row.total;

    // Active users
    db.get('SELECT COUNT(*) as total FROM users WHERE role = "user" AND is_active = 1', (err, row) => {
      if (err) return res.json({ success: false, message: 'Database error' });
      stats.activeUsers = row.total;
      stats.disabledUsers = stats.totalUsers - stats.activeUsers;

      // Today's feedings
      db.get(
        `SELECT COUNT(*) as total FROM feeding_logs WHERE DATE(timestamp) = DATE('now')`,
        (err, row) => {
          if (err) return res.json({ success: false, message: 'Database error' });
          stats.totalFeedingsToday = row.total;

          // Food dispensed today
          db.get(
            `SELECT COUNT(*) as total FROM feeding_logs 
             WHERE DATE(timestamp) = DATE('now') AND dispense_type IN ('food', 'both')`,
            (err, row) => {
              if (err) return res.json({ success: false, message: 'Database error' });
              stats.foodDispensedToday = row.total;

              // Water dispensed today
              db.get(
                `SELECT COUNT(*) as total FROM feeding_logs 
                 WHERE DATE(timestamp) = DATE('now') AND dispense_type IN ('water', 'both')`,
                (err, row) => {
                  if (err) return res.json({ success: false, message: 'Database error' });
                  stats.waterDispensedToday = row.total;

                  // Active schedules
                  db.get(
                    'SELECT COUNT(*) as total FROM schedules WHERE is_active = 1',
                    (err, row) => {
                      if (err) return res.json({ success: false, message: 'Database error' });
                      stats.activeSchedules = row.total;

                      // Device status
                      db.get('SELECT * FROM device_status ORDER BY id DESC LIMIT 1', (err, device) => {
                        if (err) return res.json({ success: false, message: 'Database error' });
                        stats.arduinoStatus = device ? device.arduino_status : 'unknown';
                        stats.rpiStatus = device ? device.rpi_status : 'online';

                        res.json({ success: true, stats });
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
});

// Get All Users
router.get('/users', (req, res) => {
  const db = req.app.locals.db;
  
  db.all(
    `SELECT id, email, pet_name, pet_type, pet_age, pet_weight, is_active, created_at 
     FROM users WHERE role = 'user' ORDER BY created_at DESC`,
    (err, users) => {
      if (err) {
        console.error('Database error:', err);
        return res.json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, users });
    }
  );
});

// Add New User
router.post('/users', (req, res) => {
  const { email, password, pet_name, pet_type, pet_age, pet_weight } = req.body;
  
  if (!email || !password) {
    return res.json({ success: false, message: 'Email and password are required' });
  }

  const db = req.app.locals.db;
  
  // Check if email already exists
  db.get('SELECT id FROM users WHERE email = ?', [email], (err, existing) => {
    if (err) return res.json({ success: false, message: 'Database error' });
    if (existing) return res.json({ success: false, message: 'Email already exists' });

    // Hash password
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) return res.json({ success: false, message: 'Error hashing password' });

      db.run(
        `INSERT INTO users (email, password_hash, role, pet_name, pet_type, pet_age, pet_weight, is_active) 
         VALUES (?, ?, 'user', ?, ?, ?, ?, 1)`,
        [email, hash, pet_name, pet_type, pet_age, pet_weight],
        function(err) {
          if (err) {
            console.error('Error creating user:', err);
            return res.json({ success: false, message: 'Error creating user' });
          }

          // Create default settings for user
          db.run(
            `INSERT INTO user_settings (user_id, theme, notifications_enabled) VALUES (?, 'light', 1)`,
            [this.lastID]
          );

          // Log action
          db.run(
            `INSERT INTO system_logs (log_type, message) VALUES ('user_created', ?)`,
            [`Admin created user: ${email}`]
          );

          // Broadcast update
          req.app.locals.io.emit('user-created', { email, pet_name });

          res.json({ success: true, message: 'User created successfully', userId: this.lastID });
        }
      );
    });
  });
});

// Update User
router.put('/users/:id', (req, res) => {
  const { id } = req.params;
  const { email, pet_name, pet_type, pet_age, pet_weight } = req.body;
  
  const db = req.app.locals.db;
  
  db.run(
    `UPDATE users SET email = ?, pet_name = ?, pet_type = ?, pet_age = ?, pet_weight = ? 
     WHERE id = ? AND role = 'user'`,
    [email, pet_name, pet_type, pet_age, pet_weight, id],
    function(err) {
      if (err) {
        console.error('Error updating user:', err);
        return res.json({ success: false, message: 'Error updating user' });
      }

      if (this.changes === 0) {
        return res.json({ success: false, message: 'User not found' });
      }

      // Log action
      db.run(
        `INSERT INTO system_logs (log_type, message) VALUES ('user_updated', ?)`,
        [`Admin updated user ID: ${id}`]
      );

      // Broadcast update
      req.app.locals.io.emit('user-updated', { id, email, pet_name });

      res.json({ success: true, message: 'User updated successfully' });
    }
  );
});

// Enable/Disable User
router.patch('/users/:id/status', (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  
  const db = req.app.locals.db;
  
  db.run(
    `UPDATE users SET is_active = ? WHERE id = ? AND role = 'user'`,
    [is_active ? 1 : 0, id],
    function(err) {
      if (err) {
        console.error('Error updating user status:', err);
        return res.json({ success: false, message: 'Error updating user status' });
      }

      if (this.changes === 0) {
        return res.json({ success: false, message: 'User not found' });
      }

      const action = is_active ? 'enabled' : 'disabled';
      
      // Log action
      db.run(
        `INSERT INTO system_logs (log_type, message) VALUES ('user_status_changed', ?)`,
        [`Admin ${action} user ID: ${id}`]
      );

      // Broadcast update
      req.app.locals.io.emit('user-status-changed', { id, is_active });

      res.json({ success: true, message: `User ${action} successfully` });
    }
  );
});

// Reset User Password
router.patch('/users/:id/password', (req, res) => {
  const { id } = req.params;
  const { new_password } = req.body;
  
  if (!new_password) {
    return res.json({ success: false, message: 'New password is required' });
  }

  const db = req.app.locals.db;
  
  bcrypt.hash(new_password, 10, (err, hash) => {
    if (err) return res.json({ success: false, message: 'Error hashing password' });

    db.run(
      `UPDATE users SET password_hash = ? WHERE id = ? AND role = 'user'`,
      [hash, id],
      function(err) {
        if (err) {
          console.error('Error resetting password:', err);
          return res.json({ success: false, message: 'Error resetting password' });
        }

        if (this.changes === 0) {
          return res.json({ success: false, message: 'User not found' });
        }

        // Log action
        db.run(
          `INSERT INTO system_logs (log_type, message) VALUES ('password_reset', ?)`,
          [`Admin reset password for user ID: ${id}`]
        );

        res.json({ success: true, message: 'Password reset successfully' });
      }
    );
  });
});

// Delete User
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;
  const db = req.app.locals.db;
  
  // Delete user and all related data (CASCADE)
  db.run(
    `DELETE FROM users WHERE id = ? AND role = 'user'`,
    [id],
    function(err) {
      if (err) {
        console.error('Error deleting user:', err);
        return res.json({ success: false, message: 'Error deleting user' });
      }

      if (this.changes === 0) {
        return res.json({ success: false, message: 'User not found' });
      }

      // Log action
      db.run(
        `INSERT INTO system_logs (log_type, message) VALUES ('user_deleted', ?)`,
        [`Admin deleted user ID: ${id}`]
      );

      // Broadcast update
      req.app.locals.io.emit('user-deleted', { id });

      res.json({ success: true, message: 'User deleted successfully' });
    }
  );
});

// Get System Logs
router.get('/logs', (req, res) => {
  const { filter } = req.query; // today, week, month
  const db = req.app.locals.db;
  
  let dateFilter = '';
  if (filter === 'today') {
    dateFilter = `WHERE DATE(created_at) = DATE('now')`;
  } else if (filter === 'week') {
    dateFilter = `WHERE DATE(created_at) >= DATE('now', '-7 days')`;
  } else if (filter === 'month') {
    dateFilter = `WHERE DATE(created_at) >= DATE('now', '-30 days')`;
  }
  
  db.all(
    `SELECT * FROM system_logs ${dateFilter} ORDER BY created_at DESC LIMIT 500`,
    (err, logs) => {
      if (err) {
        console.error('Database error:', err);
        return res.json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, logs });
    }
  );
});

// Get Feeding Logs
router.get('/feeding-logs', (req, res) => {
  const { filter } = req.query;
  const db = req.app.locals.db;
  
  let dateFilter = '';
  if (filter === 'today') {
    dateFilter = `WHERE DATE(fl.timestamp) = DATE('now')`;
  } else if (filter === 'week') {
    dateFilter = `WHERE DATE(fl.timestamp) >= DATE('now', '-7 days')`;
  } else if (filter === 'month') {
    dateFilter = `WHERE DATE(fl.timestamp) >= DATE('now', '-30 days')`;
  }
  
  db.all(
    `SELECT fl.*, u.email, u.pet_name 
     FROM feeding_logs fl 
     LEFT JOIN users u ON fl.user_id = u.id 
     ${dateFilter} 
     ORDER BY fl.timestamp DESC LIMIT 500`,
    (err, logs) => {
      if (err) {
        console.error('Database error:', err);
        return res.json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, logs });
    }
  );
});

// Get Device Status
router.get('/device-status', (req, res) => {
  const db = req.app.locals.db;
  
  db.get(
    'SELECT * FROM device_status ORDER BY id DESC LIMIT 1',
    (err, status) => {
      if (err) {
        console.error('Database error:', err);
        return res.json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, status });
    }
  );
});

// Get System Settings
router.get('/settings', (req, res) => {
  const db = req.app.locals.db;
  
  db.all('SELECT * FROM system_settings', (err, settings) => {
    if (err) {
      console.error('Database error:', err);
      return res.json({ success: false, message: 'Database error' });
    }
    
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.setting_key] = s.setting_value;
    });
    
    res.json({ success: true, settings: settingsObj });
  });
});

// Update System Settings
router.put('/settings', (req, res) => {
  const { feed_duration, pump_duration, notification_enabled } = req.body;
  const db = req.app.locals.db;
  
  const updates = [
    ['feed_duration', feed_duration],
    ['pump_duration', pump_duration],
    ['notification_enabled', notification_enabled]
  ];
  
  let completed = 0;
  updates.forEach(([key, value]) => {
    db.run(
      `UPDATE system_settings SET setting_value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?`,
      [value, key],
      (err) => {
        if (err) console.error('Error updating setting:', err);
        completed++;
        
        if (completed === updates.length) {
          // Log action
          db.run(
            `INSERT INTO system_logs (log_type, message) VALUES ('settings_updated', ?)`,
            ['Admin updated system settings']
          );
          
          res.json({ success: true, message: 'Settings updated successfully' });
        }
      }
    );
  });
});

module.exports = router;
