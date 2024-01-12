const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const redis = require("redis");
const cors = require('cors')


const app = express();
const server = http.createServer(app);
const io = new socketIO.Server(server, {
  cors: {
    origin: "http://localhost:3000",
  },
});

// Redis client setup
let redisClient;
try {
  redisClient = redis.createClient({
    host: "127.0.0.1",
    port: 6379,
    legacyMode: true,
  });
  (async () => {
    await redisClient.connect();
    console.log("Connected to Redis");
  })();
} catch (error) {
  console.error("Error connecting to Redis:", error);
}

// io.use(authenticateToken);
app.use(express.json());
app.use(cors(
    {
        origin: 'http://localhost:3000',
    }
));

// Handle connections
io.on("connection", (socket) => {
  console.log("A user connected:", socket.handshake.query);

  const { userId } = socket.handshake.query;
  // Attach device information to the socket
  const deviceInfo = {
    socketId: socket.id,
  };

  console.log("sockerId", socket.id);

  // Attach device information to the user in Redis
  //   redisClient.hSet(`user:${userId}`, deviceInfo.socketId, true);
  redisClient.hSet(
    `user:${userId}`,
    deviceInfo.socketId,
    "true",
    async (err, result) => {
      if (err) {
        console.error("Error setting value in Redis:", err);
        // Handle the error as needed
      } else {
        // Value set successfully
        const notificationKey = `user:${userId}:notifications`;
        const userNotifications = await redisClient.json.get(
          notificationKey,
          "$"
        );
        if (userNotifications) {
            console.log("userNotifications", userNotifications);
            io.to(socket.id).emit("notification", userNotifications);
        }
      }
    }
  );

  // Handle events when a user disconnects
  socket.on("disconnect", () => {
    console.log("User disconnected");
    // Remove the disconnected device from the user's devices in Redis
    redisClient.hDel(`user:${userId}`, deviceInfo.socketId);
  });
});

app.post("/send-push-notification/:userId", async (req, res) => {
  const { userId } = req.params;
  let notificationData = req.body;
  notificationData["id"] = generateNotificationId();
  console.log(notificationData);

  // Define the key for storing notifications in Redis
  const notificationKey = `user:${userId}:notifications`;

  // Retrieve the user's active sockets from Redis
  redisClient.hKeys(`user:${userId}`, async (err, activeSockets) => {
    if (err) {
      console.error("Error retrieving user devices:", err);
      return res.status(500).json({ message: "Internal Server Error" });
    }

    if (!activeSockets || activeSockets.length === 0) {
      // No active sockets found, handle accordingly (e.g., notify the user or log)
      return res
        .status(404)
        .json({ message: "No active sockets found for the user" });
    }

    // Update Redis with the new notification
    try {
      let userNotifications = await redisClient.json.get(notificationKey, "$");
      if (!userNotifications) {
        // Initialize userNotifications with an empty object
        userNotifications = { unread: [], read: [] };
      }

      userNotifications.unread.push(notificationData);
      console.log(userNotifications);
      // Store the updated notification status in Redis
      await redisClient.json.set(notificationKey, "$", userNotifications);

      // Emit the notification to the user's active sockets
      activeSockets.forEach((socketId) => {
        io.to(socketId).emit("notification", userNotifications);
      });
      res.status(200).json({ message: "Notification sent successfully" });
    } catch (jsonSetError) {
      console.error(
        "Error updating user notifications in Redis:",
        jsonSetError
      );
      res.status(500).json({ message: "Internal Server Error" });
    }
  });
});

// ...

app.post(
  "/mark-notification-as-read/:userId/:notificationId",
  async (req, res) => {
    const { userId, notificationId } = req.params;

    // Define the key for storing notifications in Redis
    const notificationKey = `user:${userId}:notifications`;

    try {
      let userNotifications = await redisClient.json.get(notificationKey, "$");

      if (!userNotifications) {
        // Initialize userNotifications with an empty object
        userNotifications = { unread: [], read: [] };
      }

      // Find the index of the notification with the specified ID in the unread list
      const index = userNotifications.unread.findIndex(
        (notification) => notification.id === notificationId
      );

      if (index !== -1) {
        // Remove the notification from the unread list
        const removedNotification = userNotifications.unread.splice(
          index,
          1
        )[0];

        // Add the removed notification to the read list
        userNotifications.read.push(removedNotification);

        // Store the updated notification status in Redis
        await redisClient.json.set(notificationKey, "$", userNotifications);

        // Emit the updated notification status to the user's active sockets
        redisClient.hKeys(`user:${userId}`, (err, activeSockets) => {
          if (err) {
            console.error("Error retrieving user devices:", err);
            return res.status(500).json({ message: "Internal Server Error" });
          }

          activeSockets.forEach((socketId) => {
            io.to(socketId).emit("notification", userNotifications);
          });

          res
            .status(200)
            .json({ message: "Notification marked as read successfully" });
        });
      } else {
        // Notification not found in the unread list
        res
          .status(404)
          .json({ message: "Notification not found in the unread list" });
      }
    } catch (jsonSetError) {
      console.error(
        "Error updating user notifications in Redis:",
        jsonSetError
      );
      res.status(500).json({ message: "Internal Server Error" });
    }
  }
);

// ...

// Function to generate a unique notification ID
function generateNotificationId() {
  return Date.now().toString();
}

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
