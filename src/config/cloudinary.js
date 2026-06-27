import { v2 as cloudinary } from "cloudinary";
import logger from "./logger.js";

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "gft-cloud",
  api_key: process.env.CLOUDINARY_API_KEY || "key",
  api_secret: process.env.CLOUDINARY_API_SECRET || "secret",
});

logger.info("Cloudinary configured successfully");

export default cloudinary;
