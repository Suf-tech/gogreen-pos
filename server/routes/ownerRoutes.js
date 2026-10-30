
const express = require("express");
const crypto = require("crypto");
const { getAuth } = require("firebase-admin/auth");
const {
  getFirestore,
  FieldValue,
  Timestamp
} = require("firebase-admin/firestore");

const verifySuperAdmin = require("../middleware/verifySuperAdmin");

const adminRouter = express.Router();
const ownerRouter = express.Router();

const EXPIRY_MS = 24 * 60 * 60 * 1000;

const cleanEmail = (value) =>
  String(value || "").trim().toLowerCase();

const cleanName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const hashToken = (token) =>
  crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

const validToken = (token) =>
  typeof token === "string" &&
  /^[a-f0-9]{64}$/.test(token);

function fail(res, status, message) {
  return res.status(status).json({
    success: false,
    message
  });
}

function appError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// ========================================
// 1. Generate / Regenerate Activation Link
// Super Admin Only
// ========================================

adminRouter.post(
  "/businesses/:businessId/activation",
  verifySuperAdmin,
  async (req, res) => {
    try {
      const businessId = req.params.businessId;

      if (
        !businessId ||
        businessId.length > 200 ||
        businessId.includes("/")
      ) {
        return fail(res, 400, "Invalid business ID.");
      }

      const db = getFirestore();

      const businessRef = db
        .collection("businesses")
        .doc(businessId);

      const token = crypto
        .randomBytes(32)
        .toString("hex");

      const hash = hashToken(token);

      const expiresAt = Timestamp.fromMillis(
        Date.now() + EXPIRY_MS
      );

      const activationRef = db
        .collection("ownerActivations")
        .doc(hash);

      let businessSlug = "";
      let ownerEmail = "";

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(businessRef);

        if (!snap.exists) {
          throw appError(404, "Business not found.");
        }

        const business = snap.data();

        if (business.ownerUid) {
          throw appError(
            409,
            "Owner account is already linked."
          );
        }

        if (business.status !== "active") {
          throw appError(
            400,
            "Activate the business first."
          );
        }

        businessSlug = business.slug;
        ownerEmail = cleanEmail(business.ownerEmail);

        if (
          !businessSlug ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(businessSlug)
        ) {
          throw appError(
            400,
            "Invalid business POS slug."
          );
        }

        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)
        ) {
          throw appError(
            400,
            "Invalid owner email."
          );
        }

        tx.set(activationRef, {
          businessId,
          email: ownerEmail,
          tokenHash: hash,
          expiresAt,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: req.adminUser.uid,
          claimedAt: null,
          claimedBy: null
        });

        // Only the latest generated token is valid.
        tx.update(businessRef, {
          ownerActivationHash: hash,
          activationExpiresAt: expiresAt
        });
      });

      const baseUrl = (
        process.env.CLIENT_URL ||
        "http://localhost:5173"
      ).replace(/\/+$/, "");

      return res.status(201).json({
        success: true,
        message: "Activation link generated.",
        activationUrl:
          `${baseUrl}/pos/${businessSlug}?activate=${token}`,
        ownerEmail,
        expiresAt: expiresAt.toDate().toISOString()
      });
    } catch (error) {
      console.error("Generate activation:", error);

      return fail(
        res,
        error.status || 500,
        error.status
          ? error.message
          : "Activation generation failed."
      );
    }
  }
);

// ========================================
// 2. Public POS Business Lookup
// ========================================

ownerRouter.get("/pos/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;

    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    ) {
      return fail(res, 400, "Invalid POS URL.");
    }

    const db = getFirestore();

    const slugSnap = await db
      .collection("businessSlugs")
      .doc(slug)
      .get();

    if (!slugSnap.exists) {
      return fail(res, 404, "Business not found.");
    }

    const businessId = slugSnap.data().businessId;

    const businessSnap = await db
      .collection("businesses")
      .doc(businessId)
      .get();

    if (!businessSnap.exists) {
      return fail(res, 404, "Business not found.");
    }

    const business = businessSnap.data();

    if (business.status !== "active") {
      return fail(res, 403, "Business is disabled.");
    }

    return res.json({
      success: true,
      business: {
        id: businessId,
        name: business.name,
        slug: business.slug,
        activated: Boolean(business.ownerUid)
      }
    });
  } catch (error) {
    console.error("POS lookup:", error);
    return fail(res, 500, "Unable to load business.");
  }
});

// ========================================
// 3. Validate Activation Token
// ========================================

ownerRouter.get(
  "/activation/:token",
  async (req, res) => {
    try {
      const token = req.params.token;

      if (!validToken(token)) {
        return fail(
          res,
          400,
          "Invalid activation token."
        );
      }

      const db = getFirestore();
      const hash = hashToken(token);

      const activationSnap = await db
        .collection("ownerActivations")
        .doc(hash)
        .get();

      if (!activationSnap.exists) {
        return fail(
          res,
          404,
          "Activation not found."
        );
      }

      const activation = activationSnap.data();

      if (
        activation.claimedAt ||
        !activation.expiresAt ||
        activation.expiresAt.toMillis() <= Date.now()
      ) {
        return fail(
          res,
          410,
          "Activation expired or already used."
        );
      }

      const businessSnap = await db
        .collection("businesses")
        .doc(activation.businessId)
        .get();

      if (!businessSnap.exists) {
        return fail(
          res,
          404,
          "Business not found."
        );
      }

      const business = businessSnap.data();

      if (
        business.ownerUid ||
        business.ownerActivationHash !== hash ||
        business.status !== "active" ||
        cleanEmail(business.ownerEmail) !==
          activation.email
      ) {
        return fail(
          res,
          410,
          "Activation no longer valid."
        );
      }

      return res.json({
        success: true,
        activation: {
          businessName: business.name,
          slug: business.slug,
          ownerEmail: activation.email,
          expiresAt:
            activation.expiresAt
              .toDate()
              .toISOString()
        }
      });
    } catch (error) {
      console.error("Check activation:", error);

      return fail(
        res,
        500,
        "Unable to verify activation."
      );
    }
  }
);

// ========================================
// 4. Firebase Verified Owner Middleware
// ========================================

async function verifyOwner(req, res, next) {
  try {
    const authorization =
      req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
      return fail(res, 401, "Login required.");
    }

    const decoded = await getAuth().verifyIdToken(
      authorization.slice(7).trim(),
      true
    );

    const user = await getAuth().getUser(decoded.uid);

    if (
      user.disabled ||
      !user.email ||
      !user.emailVerified
    ) {
      return fail(
        res,
        403,
        "Verify your email first."
      );
    }

    req.ownerUser = {
      uid: user.uid,
      email: cleanEmail(user.email)
    };

    next();
  } catch (error) {
    console.error("Owner verification:", error);

    return fail(
      res,
      401,
      "Invalid login session."
    );
  }
}

// ========================================
// 5. Claim Activation After Email Verify
// ========================================

ownerRouter.post(
  "/activate",
  verifyOwner,
  async (req, res) => {
    try {
      const { token, ownerName } = req.body || {};

      if (!validToken(token)) {
        return fail(
          res,
          400,
          "Invalid activation token."
        );
      }

      if (
        typeof ownerName !== "string" ||
        !ownerName.trim() ||
        ownerName.length > 150
      ) {
        return fail(
          res,
          400,
          "Owner name is required."
        );
      }

      const db = getFirestore();
      const hash = hashToken(token);

      const activationRef = db
        .collection("ownerActivations")
        .doc(hash);

      const { uid, email } = req.ownerUser;

      const userRef = db
        .collection("users")
        .doc(uid);

      let slug = "";

      await db.runTransaction(async (tx) => {
        const activationSnap =
          await tx.get(activationRef);

        if (!activationSnap.exists) {
          throw appError(
            404,
            "Activation not found."
          );
        }

        const activation = activationSnap.data();

        const businessRef = db
          .collection("businesses")
          .doc(activation.businessId);

        const [businessSnap, userSnap] =
          await Promise.all([
            tx.get(businessRef),
            tx.get(userRef)
          ]);

        if (
          activation.claimedAt ||
          !activation.expiresAt ||
          activation.expiresAt.toMillis() <= Date.now()
        ) {
          throw appError(
            410,
            "Activation expired or already used."
          );
        }

        if (activation.email !== email) {
          throw appError(
            403,
            "Verified email does not match."
          );
        }

        if (!businessSnap.exists) {
          throw appError(
            404,
            "Business not found."
          );
        }

        const business = businessSnap.data();

        if (
          business.ownerUid ||
          business.ownerActivationHash !== hash ||
          business.status !== "active" ||
          cleanEmail(business.ownerEmail) !== email
        ) {
          throw appError(
            409,
            "Business is not available."
          );
        }

        if (
          cleanName(business.ownerName) !==
          cleanName(ownerName)
        ) {
          throw appError(
            403,
            "Owner name does not match."
          );
        }

        if (userSnap.exists) {
          throw appError(
            409,
            "This Firebase account already has a platform role."
          );
        }

        slug = business.slug;

        tx.update(businessRef, {
          ownerUid: uid,
          ownerActivationHash: FieldValue.delete(),
          activationExpiresAt: FieldValue.delete(),
          ownerInviteHash: FieldValue.delete(),
          ownerLinkedAt: FieldValue.serverTimestamp()
        });

        tx.set(userRef, {
          role: "business_owner",
          businessId: businessRef.id,
          email,
          createdAt: FieldValue.serverTimestamp()
        });

        tx.update(activationRef, {
          claimedAt: FieldValue.serverTimestamp(),
          claimedBy: uid
        });
      });

      return res.json({
        success: true,
        message:
          "Business owner activated successfully.",
        role: "business_owner",
        slug
      });
    } catch (error) {
      console.error("Claim activation:", error);

      return fail(
        res,
        error.status || 500,
        error.status
          ? error.message
          : "Activation failed."
      );
    }
  }
);

// ========================================
// 6. Business Owner Login Verification
// ========================================

ownerRouter.get(
  "/pos/:slug/access",
  async (req, res) => {
    try {
      const { slug } = req.params;

      if (
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
      ) {
        return fail(
          res,
          400,
          "Invalid business URL."
        );
      }

      const authorization =
        req.headers.authorization || "";

      if (!authorization.startsWith("Bearer ")) {
        return fail(
          res,
          401,
          "Please log in first."
        );
      }

      const decoded = await getAuth().verifyIdToken(
        authorization.slice(7).trim(),
        true
      );

      const firebaseUser =
        await getAuth().getUser(decoded.uid);

      if (
        firebaseUser.disabled ||
        !firebaseUser.emailVerified
      ) {
        return fail(
          res,
          403,
          "Please verify your email before logging in."
        );
      }

      const db = getFirestore();

      const slugSnap = await db
        .collection("businessSlugs")
        .doc(slug)
        .get();

      if (!slugSnap.exists) {
        return fail(
          res,
          404,
          "Business not found."
        );
      }

      const businessId =
        slugSnap.data().businessId;

      const [businessSnap, userSnap] =
        await Promise.all([
          db.collection("businesses")
            .doc(businessId)
            .get(),
          db.collection("users")
            .doc(decoded.uid)
            .get()
        ]);

      if (!businessSnap.exists) {
        return fail(
          res,
          404,
          "Business not found."
        );
      }

      if (!userSnap.exists) {
        return fail(
          res,
          403,
          "Your business account is not activated yet."
        );
      }

      const business = businessSnap.data();
      const owner = userSnap.data();

      if (
        owner.role !== "business_owner" ||
        owner.businessId !== businessId ||
        business.ownerUid !== decoded.uid ||
        business.status !== "active" ||
        cleanEmail(business.ownerEmail) !==
          cleanEmail(firebaseUser.email)
      ) {
        return fail(
          res,
          403,
          "You do not have permission to access this business."
        );
      }

      return res.json({
        success: true,
        message:
          "Owner login verified successfully.",
        businessId,
        businessName: business.name,
        slug: business.slug,
        role: owner.role
      });
    } catch (error) {
      console.error(
        "Business owner login error:",
        error
      );

      return fail(
        res,
        401,
        "Invalid or expired login session."
      );
    }
  }
);

// ========================================
// 7. Export Routers
// ========================================

module.exports = {
  adminRouter,
  ownerRouter
};
