import mongoose from "mongoose";

const genealogySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    parentId: {
      type: String,
      trim: true,
      default: "",
    },
    sponsorId: {
      type: String,
      required: true,
      trim: true,
    },
    leftNodeId: {
      type: String,
      default: "",
    },
    rightNodeId: {
      type: String,
      default: "",
    },
    ancestors: [
      {
        type: String,
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

const Genealogy = mongoose.model("Genealogy", genealogySchema);
export default Genealogy;
