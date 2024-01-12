// authMiddleware.js
const jwt = require('jsonwebtoken');

function authenticateToken(socket, next) {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication error: Token not provided'));
  }

  jwt.verify(token, 'your_secret_key', (err, decoded) => {
    if (err) {
      return next(new Error('Authentication error: Invalid token'));
    }

    // Attach the user information to the socket for further use
    socket.user = decoded.user;
    next();
  });
}

module.exports = authenticateToken;
