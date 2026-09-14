import mongoose from "mongoose";

const genealogySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    parentId: {
      type: String,
      trim: true,
      default: "",
      uppercase: true,
    },
    sponsorId: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    leftNodeId: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },
    rightNodeId: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },
    ancestors: [
      {
        type: String,
        trim: true,
        uppercase: true,
      },
    ],
    placementLeg: {
      type: String,
      enum: ["left", "right", ""],
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// 1. Unique userId index (already defined in field definition)
// 2. Compound unique constraint preventing duplicate placement of left/right under the same parent
// Note: Uses MongoDB-supported $gt operator in partialFilterExpression
genealogySchema.index(
  { parentId: 1, placementLeg: 1 },
  {
    unique: true,
    partialFilterExpression: {
      parentId: { $gt: "" },
      placementLeg: { $gt: "" },
    },
  }
);

// 3. Sponsor index for direct referral lookups
genealogySchema.index({ sponsorId: 1 });

// 4. Parent index for immediate child lookups
genealogySchema.index({ parentId: 1 });

// 5. Multikey index on ancestors for efficient downline and ancestor chain lookups
genealogySchema.index({ ancestors: 1 });

const Genealogy = mongoose.model("Genealogy", genealogySchema);
export default Genealogy;
