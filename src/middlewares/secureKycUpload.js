/**
 * Green Future Tech (GFT) — Secure KYC Upload Middleware
 * Phase 2: Private, validated file storage pipeline.
 * 
 * Features:
 * - Stores files in private directory outside web root (no express.static exposure).
 * - Cryptographically random filename generation (zero path traversal or name collision).
 * - Multi-layer validation: extension, browser MIME, and binary magic-bytes.
 * - Enforces 5MB per document and 20MB per request limit.
 */

import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import AppError from "../utils/errors.js";
import {
  ALLOWED_KYC_EXTENSIONS,
  ALLOWED_KYC_MIME_TYPES,
  KYC_FILE_LIMITS,
} from "../utils/rules/kycConstants.js";

// Private storage directory outside public root
const PRIVATE_KYC_BASE_DIR = path.resolve(process.cwd(), "storage", "private_kyc");

// Ensure directory exists with restricted access
if (!fs.existsSync(PRIVATE_KYC_BASE_DIR)) {
  fs.mkdirSync(PRIVATE_KYC_BASE_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Isolate by user ID subfolder if user is authenticated
    const userFolder = req.user && req.user.userId ? req.user.userId : "unassigned";
    const targetDir = path.join(PRIVATE_KYC_BASE_DIR, userFolder);
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Cryptographically random 16-byte hex + timestamp
    const randomName = `${file.fieldname}_${Date.now()}_${crypto.randomBytes(16).toString("hex")}${ext}`;
    cb(null, randomName);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (!ALLOWED_KYC_EXTENSIONS.includes(ext)) {
    return cb(
      new AppError(`Invalid file format '${ext}'. Only JPG, PNG, and PDF documents are allowed.`, 400),
      false
    );
  }

  if (!ALLOWED_KYC_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new AppError(`Invalid MIME type '${file.mimetype}'. Only JPG, PNG, and PDF documents are accepted.`, 400),
      false
    );
  }

  cb(null, true);
};

export const secureKycUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: KYC_FILE_LIMITS.MAX_FILE_SIZE_BYTES, // 5 MB
    files: 4,
  },
});

/**
 * Validates magic bytes / binary signatures of uploaded files to prevent disguised executables.
 */
export const validateKycMagicBytes = async (req, res, next) => {
  try {
    const files = req.files;
    if (!files) return next();

    const fileList = [];
    if (Array.isArray(files)) {
      fileList.push(...files);
    } else if (typeof files === "object") {
      for (const key of Object.keys(files)) {
        fileList.push(...files[key]);
      }
    }

    for (const f of fileList) {
      if (!fs.existsSync(f.path)) continue;

      const buffer = Buffer.alloc(8);
      const fd = fs.openSync(f.path, "r");
      fs.readSync(fd, buffer, 0, 8, 0);
      fs.closeSync(fd);

      const ext = path.extname(f.path).toLowerCase();
      let isValid = false;

      // JPEG magic: FF D8 FF
      if (ext === ".jpg" || ext === ".jpeg") {
        isValid = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      }
      // PNG magic: 89 50 4E 47
      else if (ext === ".png") {
        isValid = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
      }
      // PDF magic: %PDF- (25 50 44 46)
      else if (ext === ".pdf") {
        isValid = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
      }

      if (!isValid) {
        // Immediately delete spoofed or corrupted file
        try { fs.unlinkSync(f.path); } catch (e) {}
        return next(
          new AppError(`File signature mismatch detected for ${f.fieldname}. File content does not match extension.`, 400)
        );
      }
    }

    next();
  } catch (err) {
    next(err);
  }
};

export default secureKycUpload;
