export type WindowExpiryCallback = (orderId: string) => Promise<void>;

export interface DispatchTimer {
  /**
   * 啟動指定訂單的收集視窗
   * @param orderId 訂單 ID
   * @param durationSeconds 視窗秒數
   * @param onExpiry 視窗到期執行的 callback
   */
  startWindow(orderId: string, durationSeconds: number, onExpiry: WindowExpiryCallback): Promise<void>;

  /**
   * 取消指定的收集視窗（如訂單中途被取消）
   */
  cancelWindow(orderId: string): Promise<void>;

  /**
   * 檢查某訂單是否仍在收集視窗中
   */
  isWindowActive(orderId: string): boolean | Promise<boolean>;

  /**
   * 釋放資源
   */
  close(): Promise<void>;
}
