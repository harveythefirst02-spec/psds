/*
 * User Routes
 * Handles user-specific operations
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAuth } = require('../middleware/authMiddleware');

// Apply authentication middleware to all user routes
router.use(requireAuth);

// Get User Dashboard Data
router.get('/dashboard', (req, res) => {
  const userId = req.session.user.id;
  const db = req.app.locals.db;
  
  // Get user profile
  db.get(
    'SELECT email, pet_name, pet_type, pet_age, pet_weight FROM users WHERE id = ?',
    [userId],
    (err, profile) => {
      if (err) return res.json({ success: false, message: 'Database error' });

      // Get last feeding
      db.get(
        `SELECT * FROM feeding_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1`,
        [userId],
        (err, lastFeeding) => {
          if (err) return res.json({ success: false, message: 'Database error' });

          // Get next schedule
          db.get(
            `SELECT * FROM schedules WHERE user_id = ? AND is_active = 1 
             ORDER BY 
               CASE WHEN ampm = 'PM' THEN hour + 12 ELSE hour END,
               minute 
             LIMIT 1`,
            [userId],
            (err, nextSchedule) => {
              if (err) return res.json({ success: false, message: 'Database error' });

              // Get device status
              db.get(
                'SELECT * FROM device_status ORDER BY id DESC LIMIT 1',
                (err, deviceStatus) => {
                  if (err) return res.json({ success: false, message: 'Database error' });

                  res.json({
                    success: true,
                    profile,
                    lastFeeding,
                    nextSchedule,
                    deviceStatus
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

// Get User Schedules
router.get('/schedules', (req, res) => {
  const userId = req.session.user.id;
  const db = req.app.locals.db;
  
  db.all(
    'SELECT * FROM schedules WHERE user_id = ? ORDER BY hour, minute',
    [userId],
    (err, schedules) => {
      if (err) {
        console.error('Database error:', err);
        return res.json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, schedules });
    }
  );
});

// Create Schedule
router.post('/schedules', (req, res) => {
  const userId = req.session.user.id;
  const { hour, minute, ampm, dispense_type } = req.body;
  
  // Validation
  if (!hour || !minute || !ampm || !dispense_type) {
    return res.json({ success: false, message: 'All fields are required' });
  }
  
  if (hour < 1 || hour > 12) {
    return res.json({ success: false, message: 'Hour must be between 1 and 12' });
  }
  
  if (minute < 0 || minute > 59) {
    return res.json({ success: false, message: 'Minute must be between 0 and 59' });
  }
  
  if (!['AM', 'PM'].includes(ampm)) {
    return res.json({ success: false, message: 'Invalid AM/PM value' });
  }
  
  if (!['food', 'water', 'both'].includes(dispense_type)) {
    return res.json({ success: false, message: 'Invalid dispense type' });
  }
  
  const db = req.app.locals.db;
  const arduinoSerial = require('../serial/arduinoSerial');
  
  db.run(
    `INSERT INTO schedules (user_id, hour, minute, ampm, dispense_type, is_active) 
     VALUES (?, ?, ?, ?, ?, 1)`,
    [userId, hour, minute, ampm, dispense_type],
    function(err) {
      if (err) {
        console.error('Error creating schedule:', err);
        return res.json({ success: false, message: 'Error creating schedule' });
      }

      // Log action
      db.run(
        `INSERT INTO system_logs (log_type, message) VALUES ('schedule_created', ?)`,
        [`User ${userId} created schedule: ${hour}:${minute} ${ampm}`]
      );

      // Sync to Arduino
      if (arduinoSerial.isConnected()) {
        arduinoSerial.sendScheduleToArduino(hour, minute, ampm, dispense_type)
          .then(() => {
            console.log(`✓ Schedule synced to Arduino: ${hour}:${minute} ${ampm}`);
          })
          .catch(err => {
            console.error('Failed to sync schedule to Arduino:', err.message);
          });
      } else {
        console.warn('Arduino not connected - schedule not synced');
      }

      // Broadcast update
      req.app.locals.io.emit('schedule-created', { 
        userId, 
        scheduleId: this.lastID,
        hour,
        minute,
        ampm,
        dispense_type
      });

      res.json({ 
        success: true, 
        message: 'Schedule created successfully',
        scheduleId: this.lastID
      });
    }
  );
});

// Update Schedule
router.put('/schedules/:id', (req, res) => {
  const userId = req.session.user.id;
  const { id } = req.params;
  const { hour, minute, ampm, dispense_type } = req.body;
  
  // Validation
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return res.json({ success: false, message: 'Invalid time values' });
  }
  
  const db = req.app.locals.db;
  
  db.run(
    `UPDATE schedules SET hour = ?, minute = ?, ampm = ?, dispense_type = ? 
     WHERE id = ? AND user_id = ?`,
    [hour, minute, ampm, dispense_type, id, userId],
    function(err) {
      if (err) {
        console.error('Error updating schedule:', err);
        return res.json({ success: false, message: 'Error updating schedule' });
      }

      if (this.changes === 0) {
        return res.json({ success: false, message: 'Schedule not found' });
      }

      // Log action
      db.run(
        `INSERT INTO system_logs (log_type, message) VALUES ('schedule_updated', ?)`,
        [`User ${userId} updated schedule ID: ${id}`]
      );

      // Broadcast update
      req.app.locals.io.emit('schedule-updated', { userId, scheduleId: id });

      res.json({ success: true, message: 'Schedule updated successfully' });
    }
  );
});

// Enable/Disable Schedule
router.patch('/schedules/:id/status', (req, res) => {
  const userId = req.session.user.id;
  const { id } = req.params;
  const { is_active } = req.body;
  
  const db = req.app.locals.db;
  
  db.run(
    `UPDATE schedules SET is_active = ? WHERE id = ? AND user_id = ?`,
    [is_active ? 1 : 0, id, userId],
    function(err) {
      if (err) {
        console.error('Error updating schedule status:', err);
        return res.json({ success: false, message: 'Error updating schedule status' });
      }

      if (this.changes === 0) {
        return res.json({ success: false, message: 'Schedule not found' });
      }

      const action = is_active ? 'enabled' : 'disabled';
      res.json({ success: true, message: `Schedule ${action} successfully` });
    }
  );
});

// Delete Schedule
router.delete('/schedules/:id', (req, res) => {
  const userId = req.session.user.id;
  const { id } = req.params;
  const db = req.app.locals.db;
  
  db.run(
    `DELETE FROM schedules WHERE id = ? AND user_id = ?`,
    [id, userId],
    function(err) {
      if (err) {
        console.error('Error deleting schedule:', err);
        return res.json({ success: false, message: 'Error deleting schedule' });
      }

      if (this.changes === 0) {
        return res.json({ success: false, message: 'Schedule not found' });
      }

      // Log action
      db.run(
        `INSERT INTO system_logs (log_type, message) VALUES ('schedule_deleted', ?)`,
        [`User ${userId} deleted schedule ID: ${id}`]
      );

      // Broadcast update
      req.app.locals.io.emit('schedule-deleted', { userId, scheduleId: id });

      res.json({ success: true, message: 'Schedule deleted successfully' });
    }
  );
});

// Get Feeding History
router.get('/feeding-history', (req, res) => {
  const userId = req.session.user.id;
  const { filter } = req.query;
  const db = req.app.locals.db;
  
  let dateFilter = '';
  if (filter === 'today') {
    dateFilter = `AND DATE(timestamp) = DATE('now')`;
  } else if (filter === 'week') {
    dateFilter = `AND DATE(timestamp) >= DATE('now', '-7 days')`;
  } else if (filter === 'month') {
    dateFilter = `AND DATE(timestamp) >= DATE('now', '-30 days')`;
  }
  
  db.all(
    `SELECT * FROM feeding_logs WHERE user_id = ? ${dateFilter} ORDER BY timestamp DESC LIMIT 200`,
    [userId],
    (err, logs) => {
      if (err) {
        console.error('Database error:', err);
        return res.json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, logs });
    }
  );
});

// Update Profile
router.put('/profile', (req, res) => {
  const userId = req.session.user.id;
  const { pet_name, pet_type, pet_age, pet_weight } = req.body;
  const db = req.app.locals.db;
  
  db.run(
    `UPDATE users SET pet_name = ?, pet_type = ?, pet_age = ?, pet_weight = ? WHERE id = ?`,
    [pet_name, pet_type, pet_age, pet_weight, userId],
    function(err) {
      if (err) {
        console.error('Error updating profile:', err);
        return res.json({ success: false, message: 'Error updating profile' });
      }

      // Update session
      req.session.user.pet_name = pet_name;

      // Log action
      db.run(
        `INSERT INTO system_logs (log_type, message) VALUES ('profile_updated', ?)`,
        [`User ${userId} updated profile`]
      );

      res.json({ success: true, message: 'Profile updated successfully' });
    }
  );
});

// Change Password
router.put('/change-password', (req, res) => {
  const userId = req.session.user.id;
  const { current_password, new_password } = req.body;
  
  if (!current_password || !new_password) {
    return res.json({ success: false, message: 'All fields are required' });
  }

  if (new_password.length < 6) {
    return res.json({ success: false, message: 'Password must be at least 6 characters' });
  }

  const db = req.app.locals.db;
  
  // Verify current password
  db.get('SELECT password_hash FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) return res.json({ success: false, message: 'Database error' });
    if (!user) return res.json({ success: false, message: 'User not found' });

    bcrypt.compare(current_password, user.password_hash, (err, match) => {
      if (err) return res.json({ success: false, message: 'Error verifying password' });
      if (!match) return res.json({ success: false, message: 'Current password is incorrect' });

      // Hash new password
      bcrypt.hash(new_password, 10, (err, hash) => {
        if (err) return res.json({ success: false, message: 'Error hashing password' });

        db.run(
          `UPDATE users SET password_hash = ? WHERE id = ?`,
          [hash, userId],
          (err) => {
            if (err) {
              console.error('Error updating password:', err);
              return res.json({ success: false, message: 'Error updating password' });
            }

            // Log action
            db.run(
              `INSERT INTO system_logs (log_type, message) VALUES ('password_changed', ?)`,
              [`User ${userId} changed password`]
            );

            res.json({ success: true, message: 'Password changed successfully' });
          }
        );
      });
    });
  });
});

// Get User Settings
router.get('/settings', (req, res) => {
  const userId = req.session.user.id;
  const db = req.app.locals.db;
  
  db.get(
    'SELECT * FROM user_settings WHERE user_id = ?',
    [userId],
    (err, settings) => {
      if (err) {
        console.error('Database error:', err);
        return res.json({ success: false, message: 'Database error' });
      }
      
      // Create default if not exists
      if (!settings) {
        db.run(
          `INSERT INTO user_settings (user_id, theme, notifications_enabled) VALUES (?, 'light', 1)`,
          [userId],
          function(err) {
            if (err) return res.json({ success: false, message: 'Error creating settings' });
            
            res.json({ 
              success: true, 
              settings: { 
                user_id: userId, 
                theme: 'light', 
                notifications_enabled: 1 
              } 
            });
          }
        );
      } else {
        res.json({ success: true, settings });
      }
    }
  );
});

// Update User Settings
router.put('/settings', (req, res) => {
  const userId = req.session.user.id;
  const { theme, notifications_enabled } = req.body;
  const db = req.app.locals.db;
  
  db.run(
    `UPDATE user_settings SET theme = ?, notifications_enabled = ? WHERE user_id = ?`,
    [theme, notifications_enabled ? 1 : 0, userId],
    function(err) {
      if (err) {
        console.error('Error updating settings:', err);
        return res.json({ success: false, message: 'Error updating settings' });
      }

      if (this.changes === 0) {
        // Create if not exists
        db.run(
          `INSERT INTO user_settings (user_id, theme, notifications_enabled) VALUES (?, ?, ?)`,
          [userId, theme, notifications_enabled ? 1 : 0],
          (err) => {
            if (err) return res.json({ success: false, message: 'Error updating settings' });
            res.json({ success: true, message: 'Settings updated successfully' });
          }
        );
      } else {
        res.json({ success: true, message: 'Settings updated successfully' });
      }
    }
  );
});

// Get Notifications
router.get('/notifications', (req, res) => {
  const userId = req.session.user.id;
  const db = req.app.locals.db;
  
  db.all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [userId],
    (err, notifications) => {
      if (err) {
        console.error('Database error:', err);
        return res.json({ success: false, message: 'Database error' });
      }
      res.json({ success: true, notifications });
    }
  );
});

// Mark Notification as Read
router.patch('/notifications/:id/read', (req, res) => {
  const userId = req.session.user.id;
  const { id } = req.params;
  const db = req.app.locals.db;
  
  db.run(
    `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
    [id, userId],
    function(err) {
      if (err) {
        console.error('Error updating notification:', err);
        return res.json({ success: false, message: 'Error updating notification' });
      }
      res.json({ success: true, message: 'Notification marked as read' });
    }
  );
});

module.exports = router;
