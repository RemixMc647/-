// ===============================================================
// REMIX-NEXUS — UNIFIED BACKEND
// One server that:
//   1) Serves the whole front-end (everything in /public)
//   2) Handles real signup / login / profile via MongoDB + JWT
//   3) Runs the live chat rooms via Socket.io
// ===============================================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');

// nodemailer is optional — if it isn't installed, or EMAIL_USER/EMAIL_PASS
// aren't set, forgot-password still works, it just logs the reset link to
// the server console instead of emailing it (handy for local testing).
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (err) { /* not installed — that's fine */ }

const app = express();

// ---- CONFIG ----
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
// Set this to your static site's real URL once deployed
// (e.g. https://remix-nexus.onrender.com). Using '*' works for testing.
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
// Set this to your deployed front-end URL so reset-password emails link to
// the right place (e.g. https://remix-nexus.example.com). Falls back to
// FRONTEND_ORIGIN, then to a relative link if neither is set.
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || (FRONTEND_ORIGIN !== '*' ? FRONTEND_ORIGIN : '');

let mailTransporter = null;
if (nodemailer && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  mailTransporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

if (!MONGODB_URI) {
  console.warn('⚠️  MONGODB_URI is not set. Signup/login/profile will not work until you add it to your .env file.');
}
if (!JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET is not set. Add a long random string to your .env file before going live.');
}

// ---- MIDDLEWARE ----
app.use(express.json());
app.use(cors({
  origin: FRONTEND_ORIGIN,
  credentials: true
}));

// ---- STATIC FRONT-END ----
const PUBLIC_DIR = __dirname;
app.use(express.static(PUBLIC_DIR));

// ---- DATABASE ----
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch((err) => console.error('❌ MongoDB connection error:', err.message));
}

// ---- HTTP + SOCKET.IO SERVER ----
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
    credentials: true
  }
});

// ---- USER MODEL ----
const AVATAR_OPTIONS = ['🎮', '🕹️', '👾', '🧱', '🚀', '⚔️', '🔥', '🏆', '🎯', '🐉'];

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  avatar: { type: String, default: '🎮' },
  createdAt: { type: Date, default: Date.now },
  resetPasswordTokenHash: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null }
});

const User = mongoose.model('User', userSchema);

// ---- HELPERS ----
function createToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    createdAt: user.createdAt
  };
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

function dbGuard(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: 'Database is not connected yet. Check MONGODB_URI in your .env file.' });
  }
  next();
}

// ---- ROUTES ----

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: '𝕽𝖊𝖒𝖎𝖝 𝕹𝖊𝖝𝖚𝖘 backend is running.',
    dbConnected: mongoose.connection.readyState === 1
  });
});

// SIGNUP
app.post('/api/signup', dbGuard, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are all required.' });
    }

    if (username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username: username.trim() }]
    });

    if (existingUser) {
      return res.status(409).json({ error: 'An account with that email or username already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = new User({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      avatar: AVATAR_OPTIONS[Math.floor(Math.random() * AVATAR_OPTIONS.length)]
    });

    await user.save();

    const token = createToken(user);

    res.status(201).json({ token, user: publicUser(user) });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Something went wrong during signup.' });
  }
});

// LOGIN
app.post('/api/login', dbGuard, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = createToken(user);

    res.json({ token, user: publicUser(user) });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Something went wrong during login.' });
  }
});

// GET CURRENT USER (protected — this is what Profile.html calls)
app.get('/api/me', dbGuard, authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// UPDATE AVATAR (protected)
app.put('/api/me/avatar', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { avatar } = req.body;

    if (!avatar || !AVATAR_OPTIONS.includes(avatar)) {
      return res.status(400).json({ error: 'Please choose a valid avatar option.' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar },
      { new: true }
    );

    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Update avatar error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// Expose the allowed avatar list so the front-end never hardcodes it twice
app.get('/api/avatar-options', (req, res) => {
  res.json({ options: AVATAR_OPTIONS });
});

// UPDATE USERNAME (protected)
app.put('/api/me/username', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }

    const trimmed = username.trim();

    const existing = await User.findOne({ username: trimmed, _id: { $ne: req.user.id } });
    if (existing) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    const user = await User.findByIdAndUpdate(req.user.id, { username: trimmed }, { new: true });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Update username error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// UPDATE PASSWORD (protected — requires current password)
app.put('/api/me/password', dbGuard, authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are both required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true });
  } catch (err) {
    console.error('Update password error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// FORGOT PASSWORD — generates a one-hour reset token. Always returns the
// same generic message, whether or not the email is registered, so this
// endpoint can't be used to check which emails have accounts.
app.post('/api/forgot-password', dbGuard, async (req, res) => {
  const genericMessage = 'If an account with that email exists, a reset link has been sent.';

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.json({ message: genericMessage });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save();

    const resetUrl = `${PUBLIC_SITE_URL}/reset-password.html?token=${rawToken}`;

    if (mailTransporter) {
      await mailTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: '𝕽𝖊𝖒𝖎𝖝 𝕹𝖊𝖝𝖚𝖘 — Reset your password',
        html: `<p>Hi ${user.username},</p>
               <p>Click the link below to reset your password. This link expires in 1 hour.</p>
               <p><a href="${resetUrl}">${resetUrl}</a></p>
               <p>If you didn't request this, you can safely ignore this email.</p>`
      });
    } else {
      // No email service configured yet — log the link so the flow is
      // still fully testable during development.
      console.log(`🔑 Password reset requested for ${user.email}. Reset link: ${resetUrl}`);
    }

    res.json({ message: genericMessage });
  } catch (err) {
    console.error('Forgot password error:', err);
    // Still return the generic message so we don't leak account existence,
    // but log the real error for debugging.
    res.json({ message: genericMessage });
  }
});

// RESET PASSWORD — consumes the token generated above
app.post('/api/reset-password', dbGuard, async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'A reset token and new password are both required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.resetPasswordTokenHash = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// ---- SOCKET.IO CHAT ----
const MAX_HISTORY_PER_ROOM = 200;
const roomHistory = new Map(); // roomId -> [{ author, text, time }]

function getHistory(roomId) {
  if (!roomHistory.has(roomId)) roomHistory.set(roomId, []);
  return roomHistory.get(roomId);
}

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('chat:join', ({ room }) => {
    if (!room || typeof room !== 'string') return;

    if (currentRoom) socket.leave(currentRoom);
    currentRoom = room;
    socket.join(room);

    socket.emit('chat:history', { room, messages: getHistory(room) });
  });

  socket.on('chat:message', ({ room, message }) => {
    if (!room || !message || typeof message.text !== 'string' || !message.text.trim()) return;

    const clean = {
      author: String(message.author || 'Guest').slice(0, 40),
      text: String(message.text).trim().slice(0, 500),
      time: Date.now(),
    };

    const history = getHistory(room);
    history.push(clean);
    if (history.length > MAX_HISTORY_PER_ROOM) history.shift();

    io.to(room).emit('chat:message', { room, message: clean });
  });

  socket.on('disconnect', () => {
    if (currentRoom) socket.leave(currentRoom);
  });
});

server.listen(PORT, () => {
  console.log(`🎮 𝕽𝖊𝖒𝖎𝖝 𝕹𝖊𝖝𝖚𝖘 server running on http://localhost:${PORT}`);
});
