import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const connectionInstance = await mongoose.connect(
      process.env.MONGODB_URI,
      { autoIndex: process.env.NODE_ENV !== "production", maxPoolSize: 20, serverSelectionTimeoutMS: 10_000 }
    );

    console.log(
      `MongoDB connected !! DB HOST: ${connectionInstance.connection.host}`
    );
  } catch (error) {
    console.error("MongoDB connection failed:", { name: error?.name, code: error?.code });
    process.exit(1);
  }
};

export default connectDB;
