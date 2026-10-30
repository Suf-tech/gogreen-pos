
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

async function verifySuperAdmin(req, res, next) {
  try {
    const authorization = req.headers.authorization || '';

    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token is required.'
      });
    }

    const token = authorization.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token.'
      });
    }

    // Verify Firebase ID token
    const decodedToken = await getAuth().verifyIdToken(token, true);

    // Check Super Admin role from Firestore
    const userDoc = await getFirestore()
      .collection('users')
      .doc(decodedToken.uid)
      .get();

    if (!userDoc.exists || userDoc.data().role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Super Admin only.'
      });
    }

    req.adminUser = {
      uid: decodedToken.uid,
      email: decodedToken.email
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);

    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token.'
    });
  }
}

module.exports = verifySuperAdmin;
