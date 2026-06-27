import { Server } from "socket.io";
import logger from "../config/logger.js";

let io;
const userSockets = new Map(); // Maps userId -> socketId for private notifies

export const initSocket = (server, frontendUrl = "*") => {
  io = new Server(server, {
    cors: {
      origin: frontendUrl,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    logger.debug(`Socket Client Connected: ${socket.id}`);

    // User authenticates/registers socket connection mapping
    socket.on("register_user", (userId) => {
      userSockets.set(userId, socket.id);
      logger.debug(`Mapped socket ${socket.id} to userId: ${userId}`);
    });

    socket.on("disconnect", () => {
      // Clean up mapping
      for (const [uid, sid] of userSockets.entries()) {
        if (sid === socket.id) {
          userSockets.delete(uid);
          logger.debug(`Removed socket mapping for userId: ${uid}`);
          break;
        }
      }
      logger.debug(`Socket Client Disconnected: ${socket.id}`);
    });
  });

  logger.info("Socket.IO Engine initialized successfully");
  return io;
};

/**
 * Sends a real-time event directly to a specific user.
 */
export const notifyUser = (userId, event, data) => {
  if (!io) return;
  const socketId = userSockets.get(userId);
  if (socketId) {
    io.to(socketId).emit(event, data);
    logger.debug(`Real-time notify sent to user ${userId} for event ${event}`);
  }
};

/**
 * Broadcasts an event to all connected dashboard socket clients.
 */
export const broadcastEvent = (event, data) => {
  if (!io) return;
  io.emit(event, data);
  logger.debug(`Real-time broadcast event ${event} sent to all active clients`);
};
