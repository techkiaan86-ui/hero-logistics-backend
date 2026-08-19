const prisma = require('../utils/prismaClient');

const NotificationTemplateController = {
  // Get all notification templates
  async getAll(req, res) {
    try {
      const companyId = req.user?.companyId || req.headers['x-company-id'];
      
      let whereClause = {};
      if (companyId) {
        whereClause.companyId = companyId;
      }

      let templates = await prisma.notificationTemplate.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' }
      });

      if (templates.length === 0 && companyId) {
        templates = await prisma.notificationTemplate.findMany({
          orderBy: { createdAt: 'desc' }
        });
      }

      return res.status(200).json({
        success: true,
        data: templates
      });
    } catch (error) {
      console.error('Error fetching notification templates:', error);
      return res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to fetch notification templates' }
      });
    }
  },

  // Create new notification template
  async create(req, res) {
    try {
      const { title, channel, body, preview, category, status } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({
          success: false,
          error: { message: 'Template Title is required' }
        });
      }

      let companyId = req.user?.companyId || req.body.companyId || req.headers['x-company-id'];

      if (!companyId) {
        const firstCompany = await prisma.company.findFirst({ select: { id: true } });
        companyId = firstCompany?.id;
      }

      const newTemplate = await prisma.notificationTemplate.create({
        data: {
          title: title.trim(),
          channel: channel || 'Email',
          body: body || preview || '',
          category: category || 'General',
          status: status || 'Active',
          companyId
        }
      });

      return res.status(201).json({
        success: true,
        message: 'Notification Template created successfully',
        data: newTemplate
      });
    } catch (error) {
      console.error('Error creating notification template:', error);
      return res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to create notification template' }
      });
    }
  },

  // Delete notification template
  async delete(req, res) {
    try {
      const { id } = req.params;
      await prisma.notificationTemplate.delete({
        where: { id }
      });

      return res.status(200).json({
        success: true,
        message: 'Notification Template deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting notification template:', error);
      return res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to delete notification template' }
      });
    }
  }
};

module.exports = NotificationTemplateController;
