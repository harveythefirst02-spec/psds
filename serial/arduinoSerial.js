/*
 * Arduino Serial Communication Module
 * Handles USB Serial Communication between Raspberry Pi and Arduino
 */

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

class ArduinoSerial {
  constructor() {
    this.port = null;
    this.parser = null;
    this.io = null;
    this.db = null;
    this.connected = false;
    this.portPath = '/dev/ttyUSB0'; // Default for Raspberry Pi
    this.baudRate = 115200;
    this.commandQueue = [];
    this.currentCommand = null;
  }

  initialize(io, db) {
    this.io = io;
    this.db = db;
    this.connect();
    
    // Attempt reconnection every 10 seconds if disconnected
    setInterval(() => {
      if (!this.connected) {
        console.log('Attempting to reconnect to Arduino...');
        this.connect();
      }
    }, 10000);
  }

  async connect() {
    try {
      // Try to find Arduino port automatically
      const ports = await SerialPort.list();
      console.log('Available ports:', ports.map(p => p.path).join(', '));
      
      // Look for common Arduino port names
      const arduinoPort = ports.find(p => 
        p.path.includes('ttyUSB') || 
        p.path.includes('ttyACM') ||
        p.path.includes('COM')
      );
      
      if (arduinoPort) {
        this.portPath = arduinoPort.path;
      }

      this.port = new SerialPort({
        path: this.portPath,
        baudRate: this.baudRate,
        autoOpen: false
      });

      this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

      this.port.open((err) => {
        if (err) {
          console.error('Error opening serial port:', err.message);
          this.connected = false;
          this.updateDeviceStatus('offline');
          return;
        }

        console.log(`✓ Connected to Arduino on ${this.portPath}`);
        this.connected = true;
        this.updateDeviceStatus('online');
        
        if (this.io) {
          this.io.emit('arduino-status', { 
            status: 'online', 
            port: this.portPath 
          });
        }

        this.logSystem('info', `Arduino connected on ${this.portPath}`);
      });

      // Handle incoming data from Arduino
      this.parser.on('data', (data) => {
        console.log('Arduino:', data);
        this.handleArduinoResponse(data.trim());
      });

      // Handle port errors
      this.port.on('error', (err) => {
        console.error('Serial port error:', err.message);
        this.connected = false;
        this.updateDeviceStatus('offline');
      });

      // Handle port close
      this.port.on('close', () => {
        console.log('Serial port closed');
        this.connected = false;
        this.updateDeviceStatus('offline');
        
        if (this.io) {
          this.io.emit('arduino-status', { 
            status: 'offline', 
            port: this.portPath 
          });
        }
      });

    } catch (error) {
      console.error('Error connecting to Arduino:', error.message);
      this.connected = false;
    }
  }

  sendCommand(command, userId = null) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        this.logSystem('error', `Failed to send command: Arduino disconnected`);
        reject(new Error('Arduino not connected'));
        return;
      }

      try {
        this.port.write(command + '\n', (err) => {
          if (err) {
            console.error('Error sending command:', err);
            this.logCommand(userId, command, 'failed');
            reject(err);
          } else {
            console.log('Command sent to Arduino:', command);
            this.currentCommand = { command, userId, resolve, reject, timestamp: Date.now() };
            this.logCommand(userId, command, 'sent');
            
            // Timeout after 10 seconds
            setTimeout(() => {
              if (this.currentCommand && this.currentCommand.command === command) {
                this.currentCommand.reject(new Error('Command timeout'));
                this.currentCommand = null;
              }
            }, 10000);
          }
        });
      } catch (error) {
        console.error('Error in sendCommand:', error);
        reject(error);
      }
    });
  }

  // Send schedule to Arduino
  async sendScheduleToArduino(hour, minute, ampm, type) {
    const command = `ADD_SCHEDULE:${hour},${minute},${ampm},${type}`;
    return this.sendCommand(command);
  }

  // Get Arduino status details
  async getArduinoStatus() {
    return this.sendCommand('GET_STATUS');
  }

  handleArduinoResponse(response) {
    // Update last heartbeat
    this.updateHeartbeat();

    // Broadcast response to all connected clients
    if (this.io) {
      this.io.emit('arduino-response', { response, timestamp: new Date() });
    }

    console.log('[Arduino Response]:', response);

    // Parse response
    if (response.includes('FOOD_DONE')) {
      console.log('[Arduino] Food dispensing completed');
      this.handleDispenseComplete('food', 'success');
    } 
    else if (response.includes('WATER_DONE')) {
      console.log('[Arduino] Water dispensing completed');
      this.handleDispenseComplete('water', 'success');
    } 
    else if (response.includes('BOTH_DONE')) {
      console.log('[Arduino] Both dispensing completed');
      this.handleDispenseComplete('both', 'success');
    } 
    else if (response.includes('STATUS_ONLINE')) {
      console.log('[Arduino] Status check: Online');
      this.connected = true;
      this.updateDeviceStatus('online');
    } 
    else if (response.includes('SCHEDULES:')) {
      const count = parseInt(response.split(':')[1]);
      console.log(`[Arduino] Active schedules: ${count}`);
      if (this.io) {
        this.io.emit('arduino-schedules', { count });
      }
    }
    else if (response.includes('UPTIME:')) {
      const uptime = parseInt(response.split(':')[1]);
      console.log(`[Arduino] Uptime: ${uptime}s`);
    }
    else if (response.includes('SCHEDULE_ADDED')) {
      console.log('[Arduino] Schedule added successfully');
      
      // Check if this is a schedule notification from keypad
      if (response.includes(':')) {
        // Format: SCHEDULE_ADDED:8,30,AM,food
        const parts = response.split(':');
        if (parts.length === 2) {
          const params = parts[1].split(',');
          if (params.length === 4) {
            const [hour, minute, ampm, type] = params;
            console.log(`[Arduino] Keypad schedule: ${hour}:${minute} ${ampm} ${type}`);
            
            // Save to database (associate with admin user ID 1)
            if (this.db) {
              this.db.run(
                `INSERT INTO schedules (user_id, hour, minute, ampm, dispense_type, is_active, created_at) 
                 VALUES (1, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
                [parseInt(hour), parseInt(minute), ampm.trim(), type.trim()],
                function(err) {
                  if (err) {
                    console.error('Error saving Arduino schedule to database:', err);
                  } else {
                    console.log(`✓ Arduino schedule saved to database (ID: ${this.lastID})`);
                  }
                }
              );
            }
            
            // Broadcast to web clients
            if (this.io) {
              this.io.emit('schedule-created', { 
                source: 'arduino',
                hour: parseInt(hour),
                minute: parseInt(minute),
                ampm: ampm.trim(),
                dispense_type: type.trim()
              });
            }
          }
        }
      }
      
      if (this.io) {
        this.io.emit('arduino-schedule-added', { success: true });
      }
    }
    else if (response.includes('ERROR')) {
      console.error('[Arduino] Error:', response);
      this.handleDispenseComplete(null, 'failed');
      this.logSystem('error', `Arduino error: ${response}`);
      
      if (this.io) {
        this.io.emit('arduino-error', { error: response });
      }
    }

    // Resolve current command if any
    if (this.currentCommand) {
      this.currentCommand.resolve(response);
      this.logCommand(this.currentCommand.userId, this.currentCommand.command, 'completed');
      this.currentCommand = null;
    }
  }

  handleDispenseComplete(type, status) {
    const userId = this.currentCommand ? this.currentCommand.userId : null;
    const source = this.currentCommand ? 'manual' : 'schedule';
    
    // Log to database
    if (this.db && type) {
      this.db.run(
        `INSERT INTO feeding_logs (user_id, dispense_type, source, status) VALUES (?, ?, ?, ?)`,
        [userId, type, source, status],
        (err) => {
          if (err) {
            console.error('Error logging dispense:', err);
          } else {
            console.log(`✓ Feeding logged: ${type} (${source}) - ${status}`);
            
            // Broadcast new feeding log to all clients
            if (this.io) {
              this.io.emit('feeding-logged', { 
                userId, 
                type, 
                source, 
                status, 
                timestamp: new Date() 
              });
            }
          }
        }
      );
    }

    // Broadcast dispense completion
    if (this.io) {
      this.io.emit('dispense-complete', { 
        type, 
        status, 
        timestamp: new Date() 
      });
    }

    // Create notification for user
    if (userId && this.db) {
      const message = status === 'success' 
        ? `${type.toUpperCase()} dispensed successfully` 
        : `Failed to dispense ${type}`;
      
      this.db.run(
        `INSERT INTO notifications (user_id, message) VALUES (?, ?)`,
        [userId, message]
      );
    }
  }

  updateDeviceStatus(status) {
    if (!this.db) return;
    
    this.db.run(
      `UPDATE device_status SET arduino_status = ?, last_heartbeat = CURRENT_TIMESTAMP WHERE id = 1`,
      [status],
      (err) => {
        if (err) console.error('Error updating device status:', err);
      }
    );
  }

  updateHeartbeat() {
    if (!this.db) return;
    
    this.db.run(
      `UPDATE device_status SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = 1`,
      (err) => {
        if (err) console.error('Error updating heartbeat:', err);
      }
    );
  }

  logCommand(userId, command, status) {
    if (!this.db) return;
    
    this.db.run(
      `INSERT INTO commands (user_id, command, status) VALUES (?, ?, ?)`,
      [userId, command, status],
      (err) => {
        if (err) console.error('Error logging command:', err);
      }
    );
  }

  logSystem(type, message) {
    if (!this.db) return;
    
    this.db.run(
      `INSERT INTO system_logs (log_type, message) VALUES (?, ?)`,
      [type, message],
      (err) => {
        if (err) console.error('Error logging system event:', err);
      }
    );
  }

  isConnected() {
    return this.connected;
  }

  getPortInfo() {
    return {
      path: this.portPath,
      baudRate: this.baudRate,
      connected: this.connected
    };
  }

  close() {
    if (this.port && this.port.isOpen) {
      this.port.close((err) => {
        if (err) {
          console.error('Error closing serial port:', err);
        } else {
          console.log('Serial port closed');
        }
      });
    }
  }
}

// Export singleton instance
module.exports = new ArduinoSerial();
