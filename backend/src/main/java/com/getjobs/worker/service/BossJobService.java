package com.getjobs.worker.service;

import com.getjobs.application.service.ConfigService;
import com.getjobs.application.service.DeliveryQuotaService;
import com.getjobs.worker.boss.Boss;
import com.getjobs.worker.boss.BossConfig;
import com.getjobs.worker.dto.JobProgressMessage;
import com.getjobs.worker.manager.PlaywrightManager;
import com.microsoft.playwright.Page;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Boss直聘任务服务
 * 管理Boss平台的投递任务执行和状态
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BossJobService implements JobPlatformService {
    private static final String PLATFORM = "boss";

    private final PlaywrightManager playwrightManager;
    private final ConfigService configService;
    private final DeliveryQuotaService quotaService;
    private final ObjectProvider<Boss> bossProvider;

    // 任务运行状态
    private volatile boolean isRunning = false;
    // 停止标志
    private volatile boolean shouldStop = false;
    // 本次任务的开始时间（毫秒），用于判断任务是不是卡死了
    private volatile long runningSince = 0L;

    @Override
    public void executeDelivery(Consumer<JobProgressMessage> progressCallback) {
        if (isRunning) {
            progressCallback.accept(JobProgressMessage.warning(PLATFORM, "任务已在运行中"));
            return;
        }

        // 两道前置闸门都只读数据库，不需要拉起浏览器：
        // 已经投够今天的目标、或者当前不在允许的时段，就没必要白开一个浏览器窗口。
        if (quotaService.isReached(PLATFORM)) {
            String reason = quotaService.reachedReason(PLATFORM);
            log.info("拒绝启动：{}（目标 {}，已投 {}）", reason, quotaService.dailyTarget(), quotaService.todayTotal());
            progressCallback.accept(JobProgressMessage.warning(PLATFORM,
                    reason + "，已自动暂停。可在「运行」页调整目标或重置今日计数"));
            return;
        }
        if (quotaService.isCoolingDown()) {
            long minutes = quotaService.cooldownRemainingMinutes();
            log.info("拒绝启动：风控冷却中，还需 {} 分钟", minutes);
            progressCallback.accept(JobProgressMessage.warning(PLATFORM, String.format(
                    "风控冷却中，还需约 %d 分钟才能继续投递（上次触发安全校验）。可在「运行」页手动解除", minutes)));
            return;
        }
        if (!quotaService.isWithinWorkHours()) {
            String window = quotaService.workWindowLabel();
            log.info("拒绝启动：当前不在允许投递的时间段（{}）", window);
            progressCallback.accept(JobProgressMessage.warning(PLATFORM, String.format(
                    "当前不在允许投递的时间段（%s），已拒绝启动。可在「运行」页调整时间段", window)));
            return;
        }

        try {
            // 浏览器可能已经被关掉（手动关窗口 / Chrome 崩溃），这时各字段仍非空，
            // 但每个操作都会抛 TargetClosedError。先确保浏览器可用，必要时重新拉起。
            progressCallback.accept(JobProgressMessage.info(PLATFORM, "检查浏览器状态..."));
            playwrightManager.ensureReady();

            // 获取Boss页面实例
            Page page = playwrightManager.getBossPage();
            if (page == null) {
                progressCallback.accept(JobProgressMessage.error(PLATFORM, "Boss页面未初始化"));
                return;
            }

            // 检查是否已登录
            if (!playwrightManager.isLoggedIn(PLATFORM)) {
                progressCallback.accept(JobProgressMessage.error(PLATFORM, "请先登录Boss直聘"));
                return;
            }

            // 通过校验后再标记运行
            isRunning = true;
            shouldStop = false;
            runningSince = System.currentTimeMillis();

            // 暂停后台登录监控，避免与投递流程并发访问同一Page
            playwrightManager.pauseBossMonitoring();

            // 加载配置（统一从 boss_config 专表读取）
            BossConfig config = configService.getBossConfig();
            progressCallback.accept(JobProgressMessage.info(PLATFORM, "配置加载成功"));

            progressCallback.accept(JobProgressMessage.info(PLATFORM, "开始投递任务..."));

            // 创建Boss实例并执行投递
            Boss.ProgressCallback bossCallback = (message, current, total) -> {
                if (current != null && total != null) {
                    progressCallback.accept(JobProgressMessage.progress(PLATFORM, message, current, total));
                } else {
                    progressCallback.accept(JobProgressMessage.info(PLATFORM, message));
                }
            };

            Boss boss = bossProvider.getObject();
            boss.setPage(page);
            boss.setConfig(config);
            boss.setProgressCallback(bossCallback);
            boss.setShouldStopCallback(this::shouldStop);
            boss.prepare();

            // 整个投递流程必须跑在 Playwright 专用线程上。
            // 原来跑在 ForkJoinPool 上，会和 scheduling-1 的登录监控同时操作同一条
            // Playwright 连接，导航被打断报 net::ERR_ABORTED，整个任务直接挂掉。
            int deliveredCount = playwrightManager.callOnPlaywright(boss::execute);

            // 撞上风控提前收工，也要说清楚原因
            if (quotaService.isCoolingDown()) {
                progressCallback.accept(JobProgressMessage.warning(PLATFORM, String.format(
                        "本次发起%d个聊天，触发安全校验已暂停，%d 分钟内不再投递",
                        deliveredCount, quotaService.cooldownRemainingMinutes())));
                return;
            }
            // 达到每日目标时给一条明确的收工提示，别让用户以为是自己点错了
            if (quotaService.isReached(PLATFORM)) {
                progressCallback.accept(JobProgressMessage.success(PLATFORM, String.format(
                        "本次发起%d个聊天，%s，自动暂停投递",
                        deliveredCount, quotaService.reachedReason(PLATFORM))));
            } else {
                progressCallback.accept(JobProgressMessage.success(PLATFORM,
                    String.format("投递任务完成，共发起%d个聊天", deliveredCount)));
            }
        } catch (Exception e) {
            log.error("Boss投递任务执行失败", e);
            progressCallback.accept(JobProgressMessage.error(PLATFORM, "投递失败: " + e.getMessage()));
        } finally {
            isRunning = false;
            shouldStop = false;
            runningSince = 0L;
            // 恢复后台登录监控
            try {
                playwrightManager.resumeBossMonitoring();
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void stopDelivery() {
        if (!isRunning) {
            return;
        }
        log.info("收到停止Boss投递任务的请求");
        shouldStop = true;

        // shouldStop 只在投递流程的检查点生效；如果任务卡在某个 Playwright 调用里，
        // 它永远看不到这个标志，isRunning 就会一直是 true，把"开始投递"永久堵死。
        // 这里给它一段时间自行退出，超时就强制把状态复位，至少让界面能重新发起任务。
        new Thread(() -> {
            long deadline = System.currentTimeMillis() + FORCE_RESET_GRACE_MS;
            while (isRunning && System.currentTimeMillis() < deadline) {
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
            if (isRunning) {
                log.warn("Boss投递任务在 {} 秒内未响应停止指令，强制复位运行状态（后台可能仍有残留操作）",
                        FORCE_RESET_GRACE_MS / 1000);
                isRunning = false;
                runningSince = 0L;
                try {
                    playwrightManager.resumeBossMonitoring();
                } catch (Exception ignored) {}
            }
        }, "boss-stop-watchdog").start();
    }

    /** 停止指令发出后，等待任务自行退出的宽限时间 */
    private static final long FORCE_RESET_GRACE_MS = 15_000L;

    /** 任务已经跑了多久（毫秒）；没在跑返回 0 */
    public long runningForMillis() {
        long since = runningSince;
        return since == 0L ? 0L : System.currentTimeMillis() - since;
    }

    @Override
    public Map<String, Object> getStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("platform", PLATFORM);
        status.put("isRunning", isRunning);
        status.put("isLoggedIn", playwrightManager.isLoggedIn(PLATFORM));
        return status;
    }

    @Override
    public String getPlatformName() {
        return PLATFORM;
    }

    @Override
    public boolean isRunning() {
        return isRunning;
    }

    /**
     * 检查是否应该停止
     * 供Boss.java调用
     */
    public boolean shouldStop() {
        return shouldStop;
    }

    
}
