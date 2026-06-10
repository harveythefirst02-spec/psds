/*
 * Database Initialization Script
 * Creates all required tables and default admin account
 */

const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

const dbPath = path.join(__dirname, 'petfeeder.db');
const db = new sqlite3.Database(dbPath);

console.log('Initializing Pet Feeder Database...');

db.serialize(() => {
  
  // Users Table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
    pet_name TEXT,
    pet_type TEXT,
    pet_age INTEGER,
    pet_weight REAL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Error creating users table:', err);
    else console.log('✓ Users table created/verified');
  });

  // Schedules Table
  db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    hour INTEGER NOT NULL,
    minute INTEGER NOT NULL,
    ampm TEXT NOT NULL CHECK(ampm IN ('AM', 'PM')),
    dispense_type TEXT NOT NULL CHECK(dispense_type IN ('food', 'water', 'both')),
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error('Error creating schedules table:', err);
    else console.log('✓ Schedules table created/verified');
  });

  // Feeding Logs Table
  db.run(`CREATE TABLE IF NOT EXISTS feeding_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    dispense_type TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('manual', 'schedule')),
    status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )`, (err) => {
    if (err) console.error('Error creating feeding_logs table:', err);
    else console.log('✓ Feeding logs table created/verified');
  });

  // Commands Table
  db.run(`CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    command TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'sent', 'completed', 'failed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  )`, (err) => {
    if (err) console.error('Error creating commands table:', err);
    else console.log('✓ Commands table created/verified');
  });

  // Notifications Table
  db.run(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error('Error creating notifications table:', err);
    else console.log('✓ Notifications table created/verified');
  });

  // Device Status Table
  db.run(`CREATE TABLE IF NOT EXISTS device_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    arduino_status TEXT NOT NULL,
    rpi_status TEXT NOT NULL,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Error creating device_status table:', err);
    else console.log('✓ Device status table created/verified');
  });

  // System Logs Table
  db.run(`CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_type TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Error creating system_logs table:', err);
    else console.log('✓ System logs table created/verified');
  });

  // User Settings Table
  db.run(`CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    theme TEXT DEFAULT 'light',
    notifications_enabled INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`, (err) => {
    if (err) console.error('Error creating user_settings table:', err);
    else console.log('✓ User settings table created/verified');
  });

  // System Settings Table
  db.run(`CREATE TABLE IF NOT EXISTS system_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error('Error creating system_settings table:', err);
    else console.log('✓ System settings table created/verified');
  });

  // Insert default admin account
  const adminEmail = 'admin';
  const adminPassword = 'admin123';
  
  bcrypt.hash(adminPassword, 10, (err, hash) => {
    if (err) {
      console.error('Error hashing admin password:', err);
      db.close();
      return;
    }
    
    db.run(`INSERT OR IGNORE INTO users (email, password_hash, role, is_active) 
            VALUES (?, ?, 'admin', 1)`, [adminEmail, hash], (err) => {
      if (err) {
        console.error('Error creating admin account:', err);
      } else {
        console.log('✓ Default admin account created (username: admin, password: admin123)');
      }
      
      // Close database after admin account creation
      db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        }
      });
    });
  });

  // Insert default system settings
  const defaultSettings = [
    ['feed_duration', '3000'],
    ['pump_duration', '5000'],
    ['notification_enabled', '1']
  ];

  const stmt = db.prepare(`INSERT OR IGNORE INTO system_settings (setting_key, setting_value) VALUES (?, ?)`);
  defaultSettings.forEach(setting => {
    stmt.run(setting);
  });
  stmt.finalize(() => {
    console.log('✓ Default system settings created');
  });

  // Insert initial device status
  db.run(`INSERT INTO device_status (arduino_status, rpi_status) 
          SELECT 'offline', 'online' 
          WHERE NOT EXISTS (SELECT 1 FROM device_status)`, (err) => {
    if (err) {
      console.error('Error creating initial device status:', err);
    } else {
      console.log('✓ Initial device status created');
    }
  });

  // Create indexes for better performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_feeding_logs_timestamp ON feeding_logs(timestamp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_schedules_user ON schedules(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at)`);
  
  console.log('✓ Database indexes created');
  console.log('\n=================================');
  console.log('Database initialization complete!');
  console.log('=================================');
});
