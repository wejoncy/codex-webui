import {$,icon} from './dom.js';
export function createSettingsView({state,rpc}) {
  const permissionModes = {
    ask: {label: '默认询问', icon: 'shield-question', help: '工作区内写入，需要提升权限时询问。'},
    'workspace-auto': {label: '工作区自动', icon: 'shield', help: '工作区内自动执行，不弹执行审批；超出权限的操作会失败。'},
    'full-access': {label: '完整访问', icon: 'lock-open', help: '完整访问，不弹执行审批；允许操作服务端账户可访问的文件和网络。'},
  };
  function setPermission(mode) {
    state.permissionMode = Object.hasOwn(permissionModes, mode) ? mode : 'ask';
    localStorage.setItem('codex-webui-permission', state.permissionMode);
    syncExecutionSettings();
  }
  function setNetworkAccess(allowed) {
    state.allowNetwork = allowed;
    localStorage.setItem('codex-webui-network', String(allowed));
    syncExecutionSettings();
  }
  function syncExecutionSettings() {
    const permission = permissionModes[state.permissionMode];
    const fullAccess = state.permissionMode === 'full-access';
    const networkEnabled = fullAccess || state.allowNetwork;
    $('permission-select').value = state.permissionMode;
    $('settings-permission-select').value = state.permissionMode;
    $('permission-control').title = `执行权限：${permission.label}`;
    $('permission-control').dataset.mode = state.permissionMode;
    $('permission-select').setAttribute('aria-label', `执行权限：${permission.label}`);
    $('permission-icon').innerHTML = icon(permission.icon);
    $('permission-help').textContent = `${permission.help} 从下一条消息生效，受服务端环境策略约束。`;
    for (const id of ['network-access','settings-network-access']) {
      $(id).checked = networkEnabled;
      $(id).disabled = fullAccess;
    }
    $('network-control').title = fullAccess ? '联网：已开启（完整访问）' : `联网：${networkEnabled ? '已开启' : '已关闭'}`;
    $('network-control').classList.toggle('is-active', networkEnabled);
    $('network-control').setAttribute('aria-disabled', String(fullAccess));
    $('network-icon').innerHTML = icon(networkEnabled ? 'globe' : 'globe-off');
  }

  async function loadModels() {
    const result = await rpc('model/list', {limit: 100});
    state.models = result.data || [];
    const selected = $('model-select').value;
    $('model-select').replaceChildren(new Option('Codex 默认模型', ''));
    for (const model of state.models.filter(m => !m.hidden)) $('model-select').append(new Option(model.displayName || model.model || model.id, model.model || model.id));
    if ([...$('model-select').options].some(o => o.value === selected)) $('model-select').value = selected;
    updateEfforts();
  }
  function updateEfforts() {
    const selected = $('effort-select').value;
    const model = state.models.find(m => (m.model || m.id) === $('model-select').value) || state.models.find(m => m.isDefault);
    $('effort-select').replaceChildren(new Option('默认强度', ''));
    const names = {none:'无',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最大',ultra:'Ultra'};
    for (const effort of model?.supportedReasoningEfforts || []) $('effort-select').append(new Option(names[effort.reasoningEffort] || effort.reasoningEffort, effort.reasoningEffort));
    if ([...$('effort-select').options].some(o => o.value === selected)) $('effort-select').value = selected;
  }
  async function loadAccount() {
    try {
      const result = await rpc('account/read', {});
      const account = result.account;
      $('account-label').textContent = account ? account.type === 'chatgpt' ? `ChatGPT · ${account.email || account.planType || '已登录'}` : 'API Key · 已配置' : '尚未登录。请在服务端运行 codex login，然后重新连接。';
    } catch { $('account-label').textContent = '当前 app-server 未提供账户信息。'; }
  }


  $('model-select').onchange = updateEfforts;
  $('permission-select').onchange = () => setPermission($('permission-select').value);
  $('settings-permission-select').onchange = () => setPermission($('settings-permission-select').value);
  $('network-access').onchange = () => setNetworkAccess($('network-access').checked);
  $('settings-network-access').onchange = () => setNetworkAccess($('settings-network-access').checked);
  setPermission(localStorage.getItem('codex-webui-permission'));
  setNetworkAccess(localStorage.getItem('codex-webui-network') === 'true');
  return {loadModels,loadAccount};
}
