import React, { useState } from 'react';
import { X, Key, Globe, Check, AlertCircle, RefreshCw } from 'lucide-react';
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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await axios.post('/api/v1/config/llm', {
        provider_name: selectedProvider,
        api_key: apiKey || undefined,
        base_url: baseUrl || undefined,
        selected_model: modelName || undefined,
        set_active: true
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
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="font-bold text-base text-slate-100 flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-400" />
            AI 大模型 API Key 配置中心
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
            <span>{isTesting ? '测试连通性中...' : '测试连通性'}</span>
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
              <span>保存并激活</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
