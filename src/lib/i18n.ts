const isZh = navigator.language.startsWith('zh');

export const t = {
  agents: isZh ? '智能体' : 'AGENTS',
  createAgent: isZh ? '新建智能体' : 'Create Agent',
  editAgent: isZh ? '编辑智能体' : 'Edit Agent',
  name: isZh ? '名称 *' : 'Name *',
  prompt: isZh ? '系统提示词 (选填)' : 'Prompt (Optional)',
  attachFiles: isZh ? '附加文件 (选填)' : 'Attach Files (Optional)',
  selectFiles: isZh ? '选择文件' : 'Select Files',
  cancel: isZh ? '取消' : 'Cancel',
  saveChanges: isZh ? '保存修改' : 'Save Changes',
  backToMain: isZh ? '返回主对话' : 'Back to Main Chat',
  workspace: isZh ? '专属工作区' : 'Workspace',
  edit: isZh ? '编辑' : 'Edit',
  delete: isZh ? '删除' : 'Delete',
  confirmTitle: isZh ? '确认删除' : 'Confirm Delete',
  confirmMessage: isZh ? '确认要删除此智能体吗？' : 'Are you sure you want to delete this agent?',
  showMore: isZh ? '展开更多' : 'Show More',
  showLess: isZh ? '收起' : 'Show Less',
};
