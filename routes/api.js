/*
 * API Routes
 * Handles Arduino communication and manual dispense operations
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/authMiddleware');
const arduinoSerial = require('../serial/arduinoSerial');

// Apply authentication middleware
router.use(requireAuth);

// Manual Dispense - Food Only
router.post('/dispense/food', async (req, res) => {
  const userId = req.session.user.id;
  
  try {
    const response = await arduinoSerial.sendCommand('DISPENSE_FOOD', userId);
    
    res.json({ 
      success: true, 
      message: 'Food dispensing initiated',
      response 
    });
  } catch (error) {
    console.error('Error dispensing food:', error);
    res.json({ 
      success: false, 
      message: 'Failed to dispense food. Arduino may be disconnected.' 
    });
  }
});

// Manual Dispense - Water Only
router.post('/dispense/water', async (req, res) => {
  const userId = req.session.user.id;
  
  try {
    const response = await arduinoSerial.sendCommand('DISPENSE_WATER', userId);
    
    res.json({ 
      success: true, 
      message: 'Water dispensing initiated',
      response 
    });
  } catch (error) {
    console.error('Error dispensing water:', error);
    res.json({ 
      success: false, 
      message: 'Failed to dispense water. Arduino may be disconnected.' 
    });
  }
});

// Manual Dispense - Both
router.post('/dispense/both', async (req, res) => {
  const userId = req.session.user.id;
  
  try {
    const response = await arduinoSerial.sendCommand('DISPENSE_BOTH', userId);
    
    res.json({ 
      success: true, 
      message: 'Food and water dispensing initiated',
      response 
    });
  } catch (error) {
    console.error('Error dispensing both:', error);
    res.json({ 
      success: false, 
      message: 'Failed to dispense. Arduino may be disconnected.' 
    });
  }
});

// Get Arduino Status
router.get('/arduino/status', (req, res) => {
  const connected = arduinoSerial.isConnected();
  const portInfo = arduinoSerial.getPortInfo();
  
  res.json({ 
    success: true, 
    connected,
    status: connected ? 'online' : 'offline',
    port: portInfo.path,
    baudRate: portInfo.baudRate
  });
});

// Get Detailed Arduino Status
router.get('/arduino/status-detailed', async (req, res) => {
  try {
    const response = await arduinoSerial.getArduinoStatus();
    
    res.json({ 
      success: true, 
      message: 'Status retrieved',
      response 
    });
  } catch (error) {
    res.json({ 
      success: false, 
      message: 'Failed to get status. Arduino may be disconnected.' 
    });
  }
});

// Test Arduino Connection
router.post('/arduino/test', async (req, res) => {
  try {
    const response = await arduinoSerial.sendCommand('GET_STATUS');
    
    res.json({ 
      success: true, 
      message: 'Arduino is responding',
      response 
    });
  } catch (error) {
    res.json({ 
      success: false, 
      message: 'Arduino is not responding' 
    });
  }
});

// Send Custom Command (Admin only)
router.post('/arduino/command', async (req, res) => {
  // Check if user is admin
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.json({ 
      success: false, 
      message: 'Admin access required' 
    });
  }

  const { command } = req.body;
  
  if (!command) {
    return res.json({ 
      success: false, 
      message: 'Command is required' 
    });
  }

  try {
    const response = await arduinoSerial.sendCommand(command);
    
    res.json({ 
      success: true, 
      message: 'Command sent successfully',
      response 
    });
  } catch (error) {
    console.error('Error sending custom command:', error);
    res.json({ 
      success: false, 
      message: 'Failed to send command' 
    });
  }
});

// Sync Schedule to Arduino
router.post('/arduino/sync-schedule', async (req, res) => {
  const { hour, minute, ampm, dispense_type } = req.body;
  
  if (!hour || !minute || !ampm || !dispense_type) {
    return res.json({ 
      success: false, 
      message: 'Missing required fields' 
    });
  }

  try {
    const response = await arduinoSerial.sendScheduleToArduino(hour, minute, ampm, dispense_type);
    
    res.json({ 
      success: true, 
      message: 'Schedule synced to Arduino',
      response 
    });
  } catch (error) {
    console.error('Error syncing schedule:', error);
    res.json({ 
      success: false, 
      message: 'Failed to sync schedule to Arduino' 
    });
  }
});

module.exports = router;
