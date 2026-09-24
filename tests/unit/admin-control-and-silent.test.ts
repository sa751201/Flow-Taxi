import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDispatchMode,
  setDispatchMode,
  isManualTakeoverActive,
  handleAdminGroupCommand,
} from '../../src/services/admin-control.js';
import {
  checkSilentQuestion,
  addSilentKeyword,
  removeSilentKeyword,
  createSilentAlertForAdmin,
} from '../../src/services/silent-questions.js';
import { createDailyReportFlexMessage } from '../../src/services/daily-reporter.js';

describe('Admin Control Center & Silent Questions Services', () => {
  beforeEach(async () => {
    // 重設回自動模式
    await setDispatchMode('auto', 'test');
  });

  describe('Admin Control Center', () => {
    it('預設應為自動派單模式', async () => {
      const mode = await getDispatchMode();
      expect(mode).toBe('auto');
      expect(await isManualTakeoverActive()).toBe(false);
    });

    it('幹部輸入「接管」指令應切換為手動接管模式', async () => {
      const reply = await handleAdminGroupCommand('接管', '張幹部');
      expect(reply).not.toBeNull();
      expect(reply?.type).toBe('text');
      expect((reply as any).text).toContain('系統已切換為人工接管模式');
      expect(await isManualTakeoverActive()).toBe(true);
    });

    it('幹部輸入「恢復」指令應恢復為自動派單模式', async () => {
      await setDispatchMode('manual', 'test');
      const reply = await handleAdminGroupCommand('恢復', '張幹部');
      expect(reply).not.toBeNull();
      expect((reply as any).text).toContain('系統已恢復機器人自動接單');
      expect(await isManualTakeoverActive()).toBe(false);
    });

    it('幹部輸入「狀態」指令應回傳當前模式與可用指令', async () => {
      const reply = await handleAdminGroupCommand('狀態', '張幹部');
      expect(reply).not.toBeNull();
      expect((reply as any).text).toContain('控制中心系統狀態');
      expect((reply as any).text).toContain('目前模式');
    });

    it('非管理指令應回傳 null', async () => {
      const reply = await handleAdminGroupCommand('大家早安！', '張幹部');
      expect(reply).toBeNull();
    });
  });

  describe('Silent Questions Service', () => {
    it('常見客訴、投訴詞句應判定為靜默', () => {
      const res1 = checkSilentQuestion('你好，我想投訴昨天的司機');
      expect(res1.isSilent).toBe(true);
      expect(res1.matchedKeyword).toBe('投訴');

      const res2 = checkSilentQuestion('司機態度太差，我有客訴！');
      expect(res2.isSilent).toBe(true);
      expect(res2.matchedKeyword).toBe('客訴');
    });

    it('遺失物品詢問應判定為靜默', () => {
      const res = checkSilentQuestion('司機先生，我的錢包好像遺失在後座了');
      expect(res.isSilent).toBe(true);
      expect(res.matchedKeyword).toBe('遺失');
    });

    it('要求真人或人工客服應判定為靜默', () => {
      const res = checkSilentQuestion('請問可以找真人客服嗎？');
      expect(res.isSilent).toBe(true);
      expect(res.matchedKeyword).toBe('找真人');
    });

    it('一般正常叫車訊息不應被判定為靜默', () => {
      const res = checkSilentQuestion('1. 上車地點: 台北車站\n2. 下車地點: 板橋車站');
      expect(res.isSilent).toBe(false);
    });

    it('動態新增與刪除自訂關鍵字', () => {
      addSilentKeyword('特定優惠代碼');
      expect(checkSilentQuestion('請問有特定優惠代碼嗎？').isSilent).toBe(true);

      removeSilentKeyword('特定優惠代碼');
      expect(checkSilentQuestion('請問有特定優惠代碼嗎？').isSilent).toBe(false);
    });

    it('產生的幹部提醒卡片應包含關鍵字與乘客訊息', () => {
      const alert = createSilentAlertForAdmin({
        passengerName: '陳先生',
        passengerUserId: 'U123456',
        messageText: '我要退費',
        matchedKeyword: '退費',
        category: '款項問題',
      });
      expect(alert.type).toBe('flex');
      expect(alert.altText).toContain('退費');
    });
  });

  describe('Daily Reporter Service', () => {
    it('應能正確產出每日營運日報 Flex Message', () => {
      const flex = createDailyReportFlexMessage({
        dateText: '2026/09/24',
        totalOrders: 25,
        completedOrders: 20,
        noDriverOrders: 3,
        cancelledOrders: 2,
        matchRatePercent: 80,
        estimatedTotalFare: 6500,
        activeDriversCount: 12,
      });

      expect(flex.type).toBe('flex');
      expect(flex.altText).toContain('每日營運戰報');
      expect(flex.altText).toContain('25 筆');
    });
  });
});
