
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

async function verifyBusinessOwner(req, res, next) {
  try {
    const header = req.headers.authorization || '';

    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token is required.'
      });
    }

    const token = header.slice(7);

    const decoded = await getAuth().verifyIdToken(
      token,
      true
    );

    if (!decoded.email_verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email first.'
      });
    }

    const db = getFirestore();

    const userSnap = await db
      .collection('users')
      .doc(decoded.uid)
      .get();

    if (!userSnap.exists) {
      return res.status(403).json({
        success: false,
        message: 'User profile not found.'
      });
    }

    const user = userSnap.data();

    if (
      user.role !== 'business_owner' ||
      !user.businessId
    ) {
      return res.status(403).json({
        success: false,
        message: 'Business owner access required.'
      });
    }

    const businessSnap = await db
      .collection('businesses')
      .doc(user.businessId)
      .get();

    if (!businessSnap.exists) {
      return res.status(404).json({
        success: false,
        message: 'Assigned business not found.'
      });
    }

    const business = businessSnap.data();

    if (
      business.ownerUid !== decoded.uid ||
      business.status !== 'active'
    ) {
      return res.status(403).json({
        success: false,
        message: 'Business access is not active.'
      });
    }

    req.owner = {
      uid: decoded.uid,
      email: decoded.email,
      businessId: user.businessId,
      businessName: business.name,
      businessPlan: business.plan
    };

    next();
  } catch (error) {
    console.error('Owner verification error:', error);

    return res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication token.'
    });
  }
}

module.exports = verifyBusinessOwner;
