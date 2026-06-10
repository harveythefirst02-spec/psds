/*
 * Pet Feeder System - Main Server
 * Raspberry Pi 4 Backend Server
 * Handles HTTP requests, WebSocket connections, and Arduino Serial Communication
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Import routes
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const apiRoutes = require('./routes/api');

// Import Arduino Serial Communication
const arduinoSerial = require('./serial/arduinoSerial');

// Initialize Express App
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Port Configuration
const PORT = process.env.PORT || 3000;

// Session Configuration
const sessionMiddleware = session({
  secret: 'pet-feeder-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true
  }
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(sessionMiddleware);

// Static Files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/user', express.static(path.join(__dirname, 'user')));

// Database Connection
const db = new sqlite3.Database('./database/petfeeder.db', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('✓ Connected to SQLite database');
  }
});

// Make database and io available globally
app.locals.db = db;
app.locals.io = io;

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/user', userRoutes);
app.use('/api', apiRoutes);

// Root Route - Serve Login Page
app.get('/', (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin/admin.html');
    } else {
      return res.redirect('/user/user.html');
    }
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
  
  // Send initial Arduino status
  socket.emit('arduino-status', {
    status: arduinoSerial.isConnected() ? 'online' : 'offline',
    port: arduinoSerial.getPortInfo()
  });
});

// Initialize Arduino Serial Communication
arduinoSerial.initialize(io, db);

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  arduinoSerial.close();
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('✓ Database connection closed');
    }
    process.exit(0);
  });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log('Pet Feeder System Server');
  console.log('=================================');
  console.log(`Server running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Network: http://192.168.100.27:${PORT}`);
  console.log('=================================');
});

module.exports = { app, io, db };
