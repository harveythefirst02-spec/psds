/*
 * Authentication Middleware
 * Verifies user session and authentication status
 */

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    // Check if account is active
    const db = req.app.locals.db;
    db.get('SELECT is_active FROM users WHERE id = ?', [req.session.user.id], (err, row) => {
      if (err || !row || !row.is_active) {
        req.session.destroy();
        return res.status(403).json({ 
          success: false, 
          message: 'Account disabled. Contact administrator.' 
        });
      }
      next();
    });
  } else {
    res.status(401).json({ 
      success: false, 
      message: 'Unauthorized. Please login.' 
    });
  }
}

function requireGuest(req, res, next) {
  if (req.session && req.session.user) {
    const redirectUrl = req.session.user.role === 'admin' 
      ? '/admin/admin.html' 
      : '/user/user.html';
    return res.redirect(redirectUrl);
  }
  next();
}

module.exports = {
  requireAuth,
  requireGuest
};
