import React, { useState, useEffect } from 'react';
import { X, Key, Globe, Check, AlertCircle, RefreshCw, MessageSquare, Send, Smartphone } from 'lucide-react';
import { LLMConfigItem } from '../types';
import axios from 'axios';

interface SettingsModalProps {
  llmConfigs: LLMConfigItem[];
  onClose: () => void;
  onRefreshConfigs: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  llmConfigs,
  onClose,
  onRefreshConfigs
}) => {
  const [selectedProvider, setSelectedProvider] = useState<string>('deepseek');
  const [apiKey, setApiKey] = useState<string>('');
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [modelName, setModelName] = useState<string>('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ status: string; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // WeChat Push States
  const [pushChannel, setPushChannel] = useState<string>('serverchan');
  const [pushKey, setPushKey] = useState<string>('');
  const [pushMaskedKey, setPushMaskedKey] = useState<string>('');
  const [pushEnabled, setPushEnabled] = useState<boolean>(false);
  const [autoPushReview, setAutoPushReview] = useState<boolean>(false);
  const [isTestingPush, setIsTestingPush] = useState<boolean>(false);
  const [pushTestResult, setPushTestResult] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    axios.get('/api/v1/config/push').then((res) => {
      if (res.data) {
        setPushChannel(res.data.channel || 'serverchan');
        setPushEnabled(res.data.is_enabled ?? false);
        setAutoPushReview(res.data.auto_push_review ?? false);
        setPushMaskedKey(res.data.secret_key_masked || '');
      }
    }).catch(() => {});
  }, []);

  const activeCfg = llmConfigs.find((c) => c.provider_name === selectedProvider);

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    const cfg = llmConfigs.find((c) => c.provider_name === provider);
    setApiKey('');
    setBaseUrl(cfg?.base_url || '');
    setModelName(cfg?.selected_model || '');
    setTestResult(null);
  };


  const handleTestConnection = async () => {
    if (!apiKey) {
      alert('请输入 API Key 后再进行测试');
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await axios.post('/api/v1/config/test-connection', {
        provider_name: selectedProvider,
        api_key: apiKey,
        base_url: baseUrl || undefined,
        model: modelName || undefined
      });
      if (res.data.status === 'success') {
        setTestResult({ status: 'success', message: 'API 连接连通性测试成功！' });
      } else {
        setTestResult({ status: 'failed', message: `测试失败 (${res.data.code}): ${res.data.detail}` });
      }
    } catch (err: any) {
      setTestResult({ status: 'failed', message: `连接异常: ${err.message}` });
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestPush = async () => {
    if (!pushKey && !pushMaskedKey) {
      alert('请输入推送 Key / Token 或 Webhook 地址后再进行测试');
      return;
    }
    setIsTestingPush(true);
    setPushTestResult(null);
    try {
      const res = await axios.post('/api/v1/config/push/test', {
        channel: pushChannel,
        secret_key: pushKey
      });
      if (res.data.status === 'success') {
        setPushTestResult({ status: 'success', message: res.data.message || '微信消息测试成功！请查收手机微信。' });
      } else {
        setPushTestResult({ status: 'failed', message: `推送失败: ${res.data.detail}` });
      }
    } catch (err: any) {
      setPushTestResult({ status: 'failed', message: `请求异常: ${err.message}` });
    } finally {
      setIsTestingPush(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (apiKey || selectedProvider) {
        await axios.post('/api/v1/config/llm', {
          provider_name: selectedProvider,
          api_key: apiKey || undefined,
          base_url: baseUrl || undefined,
          selected_model: modelName || undefined,
          set_active: true
        });
      }
      await axios.post('/api/v1/config/push', {
        channel: pushChannel,
        secret_key: pushKey || undefined,
        is_enabled: pushEnabled,
        auto_push_review: autoPushReview
      });
      onRefreshConfigs();
      onClose();
    } catch (err) {
      alert('保存设置失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="surface-card rounded-2xl max-w-xl w-full p-5 sm:p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-400" />
            系统配置中心 (API Key & 微信推送)
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Provider Selector */}
        <div className="flex space-x-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
          {['deepseek', 'kimi', 'qwen', 'openai'].map((prov) => (
            <button
              key={prov}
              onClick={() => handleProviderChange(prov)}
              className={`flex-1 py-2 text-xs font-bold uppercase rounded-lg transition-all ${
                selectedProvider === prov
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {prov}
            </button>
          ))}
        </div>

        {/* Settings Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              {selectedProvider.toUpperCase()} API Key
            </label>
            <input
              type="password"
              placeholder={activeCfg?.has_key ? `已配置 (${activeCfg.api_key_masked})` : '输入您的 API Key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Base Endpoint URL (默认留空即可)
            </label>
            <input
              type="text"
              placeholder="如: https://api.deepseek.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              模型型号 (Model Name)
            </label>
            <input
              type="text"
              placeholder="如: deepseek-chat 或 deepseek-reasoner"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500"
            />
            {selectedProvider === 'deepseek' && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-[11px] text-slate-400">预设常用型号:</span>
                <button
                  type="button"
                  onClick={() => setModelName('deepseek-chat')}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-lg border transition-all ${
                    modelName === 'deepseek-chat' || (!modelName && activeCfg?.selected_model === 'deepseek-chat')
                      ? 'bg-indigo-950 border-indigo-500 text-indigo-300 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  deepseek-chat (V3通用)
                </button>
                <button
                  type="button"
                  onClick={() => setModelName('deepseek-reasoner')}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-lg border transition-all ${
                    modelName === 'deepseek-reasoner'
                      ? 'bg-purple-950 border-purple-500 text-purple-300 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  deepseek-reasoner (R1推理)
                </button>
                <button
                  type="button"
                  onClick={() => setModelName('deepseek-v4-flash')}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-lg border transition-all ${
                    modelName === 'deepseek-v4-flash'
                      ? 'bg-amber-950 border-amber-500 text-amber-300 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  deepseek-v4-flash (极速版)
                </button>
              </div>
            )}
          </div>

          {/* WeChat Notification Section */}
          <div className="border-t border-slate-800 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <Smartphone className="w-4 h-4" />
                <span>📱 微信消息推送设置 (WeChat Push)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-[11px] text-slate-400">开启微信推送</span>
                <input
                  type="checkbox"
                  checked={pushEnabled}
                  onChange={(e) => setPushEnabled(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500 w-4 h-4"
                />
              </label>
            </div>

            {/* Channel Selector */}
            <div className="flex space-x-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
              {[
                { id: 'serverchan', label: 'Server酱 (方糖)' },
                { id: 'pushplus', label: 'PushPlus (推送加)' },
                { id: 'wechat_work', label: '企业微信机器人' }
              ].map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setPushChannel(ch.id)}
                  className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-all ${
                    pushChannel === ch.id
                      ? 'bg-emerald-700 text-white font-bold shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {ch.label}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                {pushChannel === 'serverchan' && 'Server酱 SendKey (在 sct.ftqq.com 免费获取)'}
                {pushChannel === 'pushplus' && 'PushPlus Token (在 pushplus.plus 免费获取)'}
                {pushChannel === 'wechat_work' && '企业微信 Webhook Key 或完整 URL 地址'}
              </label>
              <div className="flex space-x-2">
                <input
                  type="password"
                  placeholder={pushMaskedKey ? `已设置密钥 (${pushMaskedKey})` : '输入 SendKey / Token / Webhook'}
                  value={pushKey}
                  onChange={(e) => setPushKey(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={handleTestPush}
                  disabled={isTestingPush}
                  className="px-3 py-2 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 rounded-xl text-xs font-semibold flex items-center space-x-1 shrink-0"
                >
                  <Send className={`w-3.5 h-3.5 ${isTestingPush ? 'animate-pulse' : ''}`} />
                  <span>{isTestingPush ? '推送中...' : '测试微信推送'}</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="auto_push_check"
                checked={autoPushReview}
                onChange={(e) => setAutoPushReview(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500 w-4 h-4"
              />
              <label htmlFor="auto_push_check" className="text-xs text-slate-300 cursor-pointer">
                复盘报告生成完毕后，自动异步推送一条微信消息至手机
              </label>
            </div>

            {pushTestResult && (
              <div
                className={`p-2.5 rounded-xl border text-xs flex items-center space-x-2 ${
                  pushTestResult.status === 'success'
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                    : 'bg-red-950/60 border-red-800 text-red-300'
                }`}
              >
                {pushTestResult.status === 'success' ? (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                )}
                <span>{pushTestResult.message}</span>
              </div>
            )}
          </div>

          {/* Color Scheme Setting */}
          <div className="border-t border-slate-800 pt-4">
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              涨跌配色模式 (Price Color Scheme)
            </label>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem('color_scheme', 'A_SHARE');
                  window.dispatchEvent(new Event('storage'));
                  alert('已切换为【A股模式】：红涨 🔴 / 绿跌 🟢');
                }}
                className="flex-1 py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 hover:border-indigo-500 font-medium flex items-center justify-center space-x-2"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                <span>A股模式 (红涨绿跌)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  localStorage.setItem('color_scheme', 'INTL');
                  window.dispatchEvent(new Event('storage'));
                  alert('已切换为【美股/国际模式】：绿涨 🟢 / 红跌 🔴');
                }}
                className="flex-1 py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 hover:border-indigo-500 font-medium flex items-center justify-center space-x-2"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span>国际模式 (绿涨红跌)</span>
              </button>
            </div>
          </div>

          {/* Database Backup & Restore Setting */}
          <div className="border-t border-slate-800 pt-4">
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              数据库安全与备份管理 (Database Management)
            </label>
            <div className="flex space-x-3">
              <a
                href="/api/v1/config/db/backup"
                download
                className="flex-1 py-2 px-3 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/50 text-indigo-300 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all"
              >
                <span>💾 导出 SQLite 数据库备份</span>
              </a>
              <label className="flex-1 py-2 px-3 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 cursor-pointer transition-all">
                <span>📥 导入备份文件恢复</span>
                <input
                  type="file"
                  accept=".db"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!confirm('确定用上传的 .db 恢复数据库吗？恢复后现有数据将被替换！')) return;
                    const formData = new FormData();
                    formData.append('file', file);
                    try {
                      await axios.post('/api/v1/config/db/restore', formData);
                      alert('数据库恢复成功！即将刷新页面');
                      window.location.reload();
                    } catch (err) {
                      alert('恢复数据库失败，请确认文件格式');
                    }
                  }}
                />
              </label>
            </div>
          </div>

          {/* Test Status Banner */}
          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
                testResult.status === 'success'
                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                  : 'bg-red-950/60 border-red-800 text-red-300'
              }`}
            >
              {testResult.status === 'success' ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center border-t border-slate-800 pt-4">
          <button
            onClick={handleTestConnection}
            disabled={isTesting || !apiKey}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 flex items-center space-x-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
            <span>{isTesting ? '测试 LLM 连通性...' : '测试 LLM 连通性'}</span>
          </button>

          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl hover:bg-slate-700"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-xl hover:bg-indigo-500 shadow-md flex items-center space-x-1"
            >
              <Check className="w-4 h-4" />
              <span>保存配置</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

