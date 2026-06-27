import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    sponsorId: {
      type: String,
      required: true,
      trim: true,
    },
    sponsorName: {
      type: String,
      trim: true,
    },
    parentId: {
      type: String,
      trim: true,
      default: "",
    },
    position: {
      type: String,
      enum: ["left", "right", ""],
      default: "",
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    mobile: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["superadmin", "admin", "user"],
      default: "user",
    },
    address: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
    },
    referralCode: {
      type: String,
      unique: true,
      required: true,
    },
    rank: {
      type: String,
      enum: ["none", "silver", "gold", "emerald", "platinum", "diamond", "ruby", "chairman"],
      default: "none",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended"],
      default: "inactive",
    },
    twoFAEnabled: {
      type: Boolean,
      default: false,
    },
    twoFASecret: {
      type: String,
      default: "",
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: String,
    passwordResetToken: String,
    passwordResetExpires: Date,
    
    // Nominee Information
    nominee: {
      name: { type: String, default: "" },
      relation: { type: String, default: "" },
      mobile: { type: String, default: "" },
    },

    // KYC Status & Documents
    kyc: {
      status: {
        type: String,
        enum: ["not_submitted", "pending", "approved", "rejected"],
        default: "not_submitted",
      },
      rejectReason: { type: String, default: "" },
      aadhaarNumber: { type: String, default: "" },
      panNumber: { type: String, default: "" },
      aadhaarFrontUrl: { type: String, default: "" },
      aadhaarBackUrl: { type: String, default: "" },
      panUrl: { type: String, default: "" },
      passbookUrl: { type: String, default: "" },
      submittedAt: Date,
      reviewedAt: Date,
    },

    // Bank Details
    bankDetails: {
      accountHolderName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      bankName: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      branch: { type: String, default: "" },
    },

    // USDT Wallet details
    usdtWalletAddress: {
      type: String,
      trim: true,
      default: "",
    },

    // Active Eco package details
    activePackage: {
      packageId: { type: Schema.Types.ObjectId, ref: "Package" },
      name: { type: String, default: "" },
      amount: { type: Number, default: 0 },
      activatedAt: Date,
      expiresAt: Date,
    },

    // Binary Tree Statistics Accumulators (For matching & commission algorithms)
    leftLegSalesVolume: { type: Number, default: 0 },
    rightLegSalesVolume: { type: Number, default: 0 },
    leftLegActiveUsers: { type: Number, default: 0 },
    rightLegActiveUsers: { type: Number, default: 0 },
    
    // Temporary variables for weekly calculation
    leftLegCarryForward: { type: Number, default: 0 },
    rightLegCarryForward: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

// Encrypt password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);
export default User;
