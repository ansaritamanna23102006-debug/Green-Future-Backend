import cloudinary from "../config/cloudinary.js";
import fs from "fs";
import logger from "../config/logger.js";

/**
 * Uploads a local file to Cloudinary and deletes the local copy.
 * @param {string} filePath - Absolute or relative path to the local file
 * @param {string} folder - Destination folder in Cloudinary
 * @returns {Promise<string>} - The secure URL of the uploaded asset
 */
export const uploadToCloudinary = async (filePath, folder) => {
  try {
    if (!filePath) return "";
    
    // Check if Cloudinary is configured with actual keys or fallback dummy
    if (process.env.CLOUDINARY_API_KEY === "your_cloudinary_api_key" || !process.env.CLOUDINARY_API_KEY) {
      logger.warn(`Cloudinary not fully configured. Simulating upload for: ${filePath}`);
      // Simulate slow upload
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      // Cleanup local file
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return `https://res.cloudinary.com/dummy-cloud/image/upload/v12345/${folder}/${path.basename(filePath)}`;
    }

    const response = await cloudinary.uploader.upload(filePath, {
      folder: `gft/${folder}`,
      resource_type: "auto",
    });

    // Cleanup local file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return response.secure_url;
  } catch (error) {
    logger.error(`Cloudinary Upload Error: ${error.message}`);
    // Cleanup local file even on error
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    throw error;
  }
};

import path from "path";
export default uploadToCloudinary;
