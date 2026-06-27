import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
    },
    ipAddress: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
    },
    details: {
      type: String, // Stringified JSON or custom description
      default: "",
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // only track creation
  }
);

const AuditLog = mongoose.model("AuditLog", auditLogSchema);
export default AuditLog;
