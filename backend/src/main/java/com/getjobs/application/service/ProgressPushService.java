package com.getjobs.application.service;

import com.getjobs.worker.service.BossJobService;
import com.getjobs.worker.service.Job51JobService;
import com.getjobs.worker.service.LiepinJobService;
import com.getjobs.worker.service.ZhilianJobService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * 投递运行中的定期播报：任务真正在跑的时候，每隔 N 分钟推一条今日进度到企业微信。
 *
 * <p>和 {@link DailyReportService} 的区别：日报是每天固定一条汇总；这里是「跑着的时候
 * 报个平安」，任务停了就自动不再推。内容复用日报正文，只换标题。
 *
 * <p>计时用内存而不是数据库：重启后重新计时即可，不值得为它多写一张表。
 * 刚开跑时会先等满一个间隔再推第一条，避免点了开始立刻收到一条。
 */
@Service
public class ProgressPushService {

    private static final Logger log = LoggerFactory.getLogger(ProgressPushService.class);

    private final DailyReportService reportService;
    private final BossJobService bossJobService;
    private final LiepinJobService liepinJobService;
    private final Job51JobService job51JobService;
    private final ZhilianJobService zhilianJobService;

    /** 上一次播报的时间；0 表示还没开始计时。 */
    private volatile long lastPushAt = 0L;
    /** 上一轮检查时是否有任务在跑，用来识别「刚开始跑」。 */
    private volatile boolean wasRunning = false;

    public ProgressPushService(DailyReportService reportService,
                               BossJobService bossJobService,
                               LiepinJobService liepinJobService,
                               Job51JobService job51JobService,
                               ZhilianJobService zhilianJobService) {
        this.reportService = reportService;
        this.bossJobService = bossJobService;
        this.liepinJobService = liepinJobService;
        this.job51JobService = job51JobService;
        this.zhilianJobService = zhilianJobService;
    }

    /** 每分钟检查一次：有任务在跑、且距上次播报超过间隔，就推一条。 */
    @Scheduled(cron = "0 * * * * *")
    public void tick() {
        try {
            if (!reportService.progressEnabled()) {
                wasRunning = false;
                return;
            }
            int minutes = reportService.progressIntervalMinutes();
            if (minutes <= 0) return;

            boolean active = runningAny();
            if (!active) {
                wasRunning = false;
                return;
            }

            long now = System.currentTimeMillis();
            if (!wasRunning) {
                // 刚开始跑：先等满一个间隔，避免点开始就刷屏
                wasRunning = true;
                lastPushAt = now;
                log.info("检测到投递开始，{} 分钟后播报第一条进度", minutes);
                return;
            }
            if (now - lastPushAt < minutes * 60_000L) return;

            Map<String, Object> result = reportService.pushProgress();
            lastPushAt = now;
            log.info("投递中进度播报（间隔 {} 分钟）: {}", minutes, result.get("message"));
        } catch (RuntimeException error) {
            log.warn("投递中播报检查异常: {}", error.getMessage());
        }
    }

    private boolean runningAny() {
        return bossJobService.isRunning()
                || liepinJobService.isRunning()
                || job51JobService.isRunning()
                || zhilianJobService.isRunning();
    }
}
