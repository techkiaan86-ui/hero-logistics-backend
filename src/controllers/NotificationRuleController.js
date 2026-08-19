const prisma = require('../utils/prismaClient');

const NotificationRuleController = {
  // Get all notification rules
  async getAll(req, res) {
    try {
      const companyId = req.user?.companyId || req.headers['x-company-id'];
      
      let whereClause = {};
      if (companyId) {
        whereClause.companyId = companyId;
      }

      let rules = await prisma.notificationRule.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' }
      });

      if (rules.length === 0 && companyId) {
        rules = await prisma.notificationRule.findMany({
          orderBy: { createdAt: 'desc' }
        });
      }

      return res.status(200).json({
        success: true,
        data: rules
      });
    } catch (error) {
      console.error('Error fetching notification rules:', error);
      return res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch notification rules' }
      });
    }
  },

  // Create new notification rule
  async create(req, res) {
    try {
      const { name, trigger, channels, rec, recipient, priority, status } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Rule Name is required' }
        });
      }

      let companyId = req.user?.companyId || req.body.companyId || req.headers['x-company-id'];

      if (!companyId) {
        const firstCompany = await prisma.company.findFirst({ select: { id: true } });
        companyId = firstCompany?.id;
      }

      const newRule = await prisma.notificationRule.create({
        data: {
          name: name.trim(),
          trigger: trigger || 'When Load status changes to DELIVERED',
          channels: channels || 'SMS + Email',
          recipient: rec || recipient || 'Customer & Accounts',
          priority: priority || 'High',
          status: status || 'Enabled',
          companyId
        }
      });

      return res.status(201).json({
        success: true,
        message: 'Notification Trigger Rule activated successfully',
        data: newRule
      });
    } catch (error) {
      console.error('Error creating notification rule:', error);
      return res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to create notification rule' }
      });
    }
  },

  // Delete notification rule
  async delete(req, res) {
    try {
      const { id } = req.params;
      await prisma.notificationRule.delete({
        where: { id }
      });

      return res.status(200).json({
        success: true,
        message: 'Notification Rule deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting notification rule:', error);
      return res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to delete notification rule' }
      });
    }
  }
};

module.exports = NotificationRuleController;
