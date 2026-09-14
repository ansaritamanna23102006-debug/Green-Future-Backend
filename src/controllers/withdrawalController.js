import withdrawalService from "../services/withdrawal/withdrawalService.js";
import AppError from "../utils/errors.js";

class WithdrawalController {
  /**
   * Member: Request a new withdrawal
   * POST /api/v1/withdrawals
   */
  async requestWithdrawal(req, res, next) {
    try {
      const { amountPaisa, destinationType, destinationReference, idempotencyKey } = req.body;
      const userId = req.user.userId;

      if (!amountPaisa) {
        return next(new AppError("amountPaisa is required.", 400));
      }
      if (!destinationType) {
        return next(new AppError("destinationType is required.", 400));
      }
      if (!destinationReference) {
        return next(new AppError("destinationReference is required.", 400));
      }
      if (!idempotencyKey) {
        return next(new AppError("idempotencyKey is required.", 400));
      }

      const result = await withdrawalService.requestWithdrawal({
        userId,
        amountPaisa,
        destinationType,
        destinationReference,
        idempotencyKey,
      });

      res.status(result.isReplay ? 200 : 201).json({
        status: "success",
        data: {
          isReplay: result.isReplay,
          withdrawal: result.withdrawal,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Member: Get own withdrawal history
   * GET /api/v1/withdrawals
   */
  async getMyWithdrawals(req, res, next) {
    try {
      const userId = req.user.userId;
      const { page, limit } = req.query;

      const result = await withdrawalService.getUserWithdrawals(userId, { page, limit });

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Member/Admin: Get single withdrawal detail
   * GET /api/v1/withdrawals/:id
   */
  async getWithdrawalById(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.userId;
      const role = req.user.role;

      const withdrawal = await withdrawalService.getWithdrawalById(id, userId, role);

      res.status(200).json({
        status: "success",
        data: { withdrawal },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: List withdrawals with filters
   * GET /api/v1/withdrawals/admin/all
   */
  async getAdminWithdrawals(req, res, next) {
    try {
      const { status, userId, page, limit } = req.query;

      const result = await withdrawalService.getAdminWithdrawals({
        status,
        userId,
        page,
        limit,
      });

      res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Start review
   * POST /api/v1/withdrawals/admin/:id/review
   */
  async startReview(req, res, next) {
    try {
      const { id } = req.params;
      const adminUserId = req.user.userId;

      const withdrawal = await withdrawalService.startReview({
        withdrawalId: id,
        adminUserId,
      });

      res.status(200).json({
        status: "success",
        data: { withdrawal },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Approve withdrawal
   * POST /api/v1/withdrawals/admin/:id/approve
   */
  async approveWithdrawal(req, res, next) {
    try {
      const { id } = req.params;
      const adminUserId = req.user.userId;

      const withdrawal = await withdrawalService.approveWithdrawal({
        withdrawalId: id,
        adminUserId,
      });

      res.status(200).json({
        status: "success",
        data: { withdrawal },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Reject withdrawal
   * POST /api/v1/withdrawals/admin/:id/reject
   */
  async rejectWithdrawal(req, res, next) {
    try {
      const { id } = req.params;
      const adminUserId = req.user.userId;
      const { rejectionReason } = req.body;

      const withdrawal = await withdrawalService.rejectWithdrawal({
        withdrawalId: id,
        adminUserId,
        rejectionReason,
      });

      res.status(200).json({
        status: "success",
        data: { withdrawal },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin: Process payout via provider
   * POST /api/v1/withdrawals/admin/:id/process
   */
  async processPayout(req, res, next) {
    try {
      const { id } = req.params;

      const withdrawal = await withdrawalService.processPayout({
        withdrawalId: id,
      });

      res.status(200).json({
        status: "success",
        data: { withdrawal },
      });
    } catch (err) {
      next(err);
    }
  }
}

export default new WithdrawalController();
