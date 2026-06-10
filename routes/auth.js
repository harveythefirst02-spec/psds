/*
 * Authentication Routes
 * Handles login, logout, and session management
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.json({ 
      success: false, 
      message: 'Email and password are required' 
    });
  }

  const db = req.app.locals.db;
  
  db.get(
    'SELECT * FROM users WHERE email = ?', 
    [email], 
    (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.json({ 
          success: false, 
          message: 'Database error occurred' 
        });
      }

      if (!user) {
        // Log failed login attempt
        db.run(
          `INSERT INTO system_logs (log_type, message) VALUES ('login_failed', ?)`,
          [`Failed login attempt for email: ${email}`]
        );
        
        return res.json({ 
          success: false, 
          message: 'Invalid email or password' 
        });
      }

      // Check if account is active
      if (!user.is_active) {
        return res.json({ 
          success: false, 
          message: 'Account Disabled. Contact Administrator.' 
        });
      }

      // Verify password
      bcrypt.compare(password, user.password_hash, (err, match) => {
        if (err) {
          console.error('Bcrypt error:', err);
          return res.json({ 
            success: false, 
            message: 'Authentication error' 
          });
        }

        if (!match) {
          // Log failed login attempt
          db.run(
            `INSERT INTO system_logs (log_type, message) VALUES ('login_failed', ?)`,
            [`Failed login attempt for email: ${email}`]
          );
          
          return res.json({ 
            success: false, 
            message: 'Invalid email or password' 
          });
        }

        // Success - Create session
        req.session.user = {
          id: user.id,
          email: user.email,
          role: user.role,
          pet_name: user.pet_name
        };

        // Log successful login
        db.run(
          `INSERT INTO system_logs (log_type, message) VALUES ('login_success', ?)`,
          [`User ${email} logged in successfully`]
        );

        res.json({ 
          success: true, 
          message: 'Login successful',
          role: user.role,
          redirectUrl: user.role === 'admin' ? '/admin/admin.html' : '/user/user.html'
        });
      });
    }
  );
});

// Logout
router.post('/logout', (req, res) => {
  const userEmail = req.session.user ? req.session.user.email : 'Unknown';
  
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
      return res.json({ 
        success: false, 
        message: 'Error logging out' 
      });
    }

    // Log logout
    const db = req.app.locals.db;
    db.run(
      `INSERT INTO system_logs (log_type, message) VALUES ('logout', ?)`,
      [`User ${userEmail} logged out`]
    );

    res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  });
});

// Check Session
router.get('/check-session', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ 
      authenticated: true, 
      user: req.session.user 
    });
  } else {
    res.json({ 
      authenticated: false 
    });
  }
});

module.exports = router;
