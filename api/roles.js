// Централизованное перечисление ролей и их полномочий.
const USER_ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  CONTENT_MANAGER: "content_manager",
  EXECUTOR: "executor",
});

// Описание доступа по ролям пригодится при защите API и UI.
const ROLE_PERMISSIONS = Object.freeze({
  [USER_ROLES.SUPER_ADMIN]: {
    canManageUsers: "all",
    canManageTasks: "all",
    canManageContentPlans: true,
    canManageRoadmap: true,
    notes: "Полный доступ ко всем данным и операциям.",
  },
  [USER_ROLES.ADMIN]: {
    canManageUsers: "except_super_admins_and_admins",
    canManageTasks: "all",
    canManageContentPlans: true,
    canManageRoadmap: false,
    notes:
      "Управляет пользователями всех ролей, кроме super_admin и admin, управляет задачами, контент-планами и планом мероприятий.",
  },
  [USER_ROLES.CONTENT_MANAGER]: {
    canManageUsers: false,
    canManageTasks: "all",
    canManageContentPlans: true,
    canManageRoadmap: false,
    notes: "Управляет контент-планами, создаёт задачи и назначает исполнителей.",
  },
  [USER_ROLES.EXECUTOR]: {
    canManageUsers: false,
    canManageTasks: "own_status_only",
    canManageContentPlans: false,
    canManageRoadmap: false,
    notes: "Видит все задачи, но может менять только статус задач, где сам исполнитель.",
  },
});

module.exports = {
  USER_ROLES,
  ROLE_PERMISSIONS,
};
