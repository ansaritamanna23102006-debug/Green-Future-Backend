export const successResponse = (res, data, message = "Operation successful", statusCode = 200) => {
  return res.status(statusCode).json({
    status: "success",
    message,
    data,
  });
};

export const errorResponse = (res, message = "An error occurred", statusCode = 500) => {
  return res.status(statusCode).json({
    status: "error",
    message,
  });
};
