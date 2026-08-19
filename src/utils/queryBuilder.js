const { DEFAULT_PAGINATION } = require('../config/constants');

/**
 * Builds standard Prisma query options (where, skip, take, orderBy) from Express request query string.
 */
exports.buildPrismaQuery = (query) => {
  const { page, pageSize, sort, filter } = query;

  // 1. Pagination
  let take = parseInt(pageSize, 10) || DEFAULT_PAGINATION.PAGE_SIZE;
  if (take > DEFAULT_PAGINATION.MAX_PAGE_SIZE) {
    take = DEFAULT_PAGINATION.MAX_PAGE_SIZE;
  }
  const currentPage = parseInt(page, 10) || DEFAULT_PAGINATION.PAGE;
  const skip = (currentPage - 1) * take;

  // 2. Sorting
  let orderBy = [];
  if (sort) {
    const sortFields = sort.split(',');
    orderBy = sortFields.map((field) => {
      if (field.startsWith('-')) {
        return { [field.substring(1)]: 'desc' };
      }
      return { [field]: 'asc' };
    });
  } else {
    // Default sort
    orderBy = [{ createdAt: 'desc' }];
  }

  // 3. Filtering
  const where = {};
  const reservedKeys = ['page', 'pageSize', 'sort', 'filter'];

  // Handle direct query keys like ?role=SALES
  for (const [key, value] of Object.entries(query)) {
    if (!reservedKeys.includes(key) && value !== undefined && value !== '') {
      where[key] = value;
    }
  }

  // Handle nested filter object like ?filter[role]=SALES
  if (filter && typeof filter === 'object') {
    for (const [key, value] of Object.entries(filter)) {
      if (value) {
        where[key] = value;
      }
    }
  }

  return {
    where,
    skip,
    take,
    orderBy,
    currentPage,
    pageSize: take
  };
};

/**
 * Generates the standard pagination metadata object
 */
exports.buildPaginationMeta = (total, currentPage, pageSize, sort) => {
  return {
    page: currentPage,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    sort: sort || '-createdAt'
  };
};
