let _io = null;
const connectedUsers = new Map(); // socketId → userId

export const setIO = (io) => {
  _io = io;
  io.on("connection", (socket) => {
    socket.on("authenticate", ({ userId }) => {
      if (userId) connectedUsers.set(socket.id, parseInt(userId));
    });
    socket.on("disconnect", () => connectedUsers.delete(socket.id));
  });
};

export const getIO = () => _io;

// IDs uniques des utilisateurs connectés (hors admin optionnel)
export const getConnectedUserIds = (excludeId = null) => {
  const ids = [...new Set(connectedUsers.values())].filter(Boolean);
  return excludeId ? ids.filter(id => id !== excludeId) : ids;
};

// Émet un event vers tous les sockets d'un userId donné
export const emitToUser = (userId, event, data) => {
  if (!_io) return;
  for (const [socketId, uid] of connectedUsers.entries()) {
    if (uid === parseInt(userId)) _io.to(socketId).emit(event, data);
  }
};
