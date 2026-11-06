package com.getjobs.application.service;

import com.getjobs.worker.dto.JobProgressMessage;
import com.getjobs.worker.service.BossJobService;
import com.getjobs.worker.service.Job51JobService;
import com.getjobs.worker.service.LiepinJobService;
import com.getjobs.worker.service.ZhilianJobService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 定时自动投递：每天到点按配置顺序跑一遍指定平台。
 *
 * <p>为什么用「每分钟比对 HH:mm」而不是 cron：时间和平台都来自数据库配置，
 * 用户随时能改；cron 是启动时固定的，改完得重启后端。
 *
 * <p>为什么单线程串行：Playwright 的 Page 不是线程安全的，四个平台同时跑会
 * 互相打断导航。排队执行，总耗时更长但不会互相踩。
 *
 * <p>配额、冷却、允许时段这些闸门由各平台的 {@code executeDelivery} 自己检查，
 * 这里不重复判断 —— 到点时如果今天已经投满，任务会立刻返回，不会白开浏览器。
 */
@Service
public class AutoDeliveryService {

    private static final Logger log = LoggerFactory.getLogger(AutoDeliveryService.class);

    public static final String KEY_ENABLED = "AUTO_DELIVERY_ENABLED";
    public static final String KEY_TIME = "AUTO_DELIVERY_TIME";
    public static final String KEY_PLATFORMS = "AUTO_DELIVERY_PLATFORMS";
    public static final String KEY_LAST = "AUTO_DELIVERY_LAST";

    private static final List<String> KNOWN = List.of("boss", "liepin", "51job", "zhilian");

    private final ConfigService configService;
    private final BossJobService bossJobService;
    private final LiepinJobService liepinJobService;
    private final Job51JobService job51JobService;
    private final ZhilianJobService zhilianJobService;

    /** 单线程串行执行，避免多平台争抢同一条 Playwright 连接。 */
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "dsh-auto-delivery");
        thread.setDaemon(true);
        return thread;
    });

    public AutoDeliveryService(ConfigService configService,
                               BossJobService bossJobService,
                               LiepinJobService liepinJobService,
                               Job51JobService job51JobService,
                               ZhilianJobService zhilianJobService) {
        this.configService = configService;
        this.bossJobService = bossJobService;
        this.liepinJobService = liepinJobService;
        this.job51JobService = job51JobService;
        this.zhilianJobService = zhilianJobService;
    }

    /** 每分钟检查一次：到点且今天没跑过，就按平台顺序跑一遍。 */
    @Scheduled(cron = "0 * * * * *")
    public void tick() {
        try {
            if (!enabled()) return;
            LocalTime point = parseTime(config(KEY_TIME));
            if (point == null) return;
            LocalTime now = LocalTime.now().withSecond(0).withNano(0);
            if (now.isBefore(point)) return;

            String today = LocalDate.now().toString();
            if (today.equals(config(KEY_LAST))) return;

            // 先占位再执行：平台跑一轮可能几十分钟，占位避免这期间每分钟重复触发。
            markRun(today);
            List<String> platforms = platforms();
            log.info("[auto] 到点触发定时投递，平台顺序：{}", platforms);
            worker.submit(() -> runAll(platforms));
        } catch (RuntimeException error) {
            log.warn("定时投递检查异常: {}", error.getMessage());
        }
    }

    private void runAll(List<String> platforms) {
        for (String platform : platforms) {
            try {
                if (isRunning(platform)) {
                    log.info("[auto] {} 已在运行，跳过本次定时触发", platform);
                    continue;
                }
                log.info("[auto] 开始 {}", platform);
                switch (platform) {
                    case "boss" -> bossJobService.executeDelivery(msg -> log(msg, platform));
                    case "liepin" -> liepinJobService.executeDelivery(msg -> log(msg, platform));
                    case "51job" -> job51JobService.executeDelivery(msg -> log(msg, platform));
                    case "zhilian" -> zhilianJobService.executeDelivery(msg -> log(msg, platform));
                    default -> log.warn("[auto] 未知平台: {}", platform);
                }
                log.info("[auto] 结束 {}", platform);
            } catch (Exception error) {
                log.warn("[auto] 平台 {} 执行失败: {}", platform, error.getMessage());
            }
        }
    }

    private void log(JobProgressMessage message, String platform) {
        if (message == null) return;
        log.info("[auto][{}] {}", platform, message.getMessage());
    }

    private boolean isRunning(String platform) {
        return switch (platform) {
            case "boss" -> bossJobService.isRunning();
            case "liepin" -> liepinJobService.isRunning();
            case "51job" -> job51JobService.isRunning();
            case "zhilian" -> zhilianJobService.isRunning();
            default -> false;
        };
    }

    public boolean enabled() {
        String raw = config(KEY_ENABLED);
        return raw != null && ("1".equals(raw.trim()) || "true".equalsIgnoreCase(raw.trim()));
    }

    /** 配置的启动时间，形如 09:30；非法返回 null。 */
    public LocalTime parseTime(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            return LocalTime.parse(raw.trim().replace('：', ':'));
        } catch (RuntimeException error) {
            return null;
        }
    }

    public List<String> platforms() {
        String raw = config(KEY_PLATFORMS);
        if (raw == null || raw.isBlank()) return List.of("boss");
        List<String> result = new ArrayList<>();
        for (String part : raw.split("[,，\\s]+")) {
            String name = part.trim().toLowerCase();
            if (KNOWN.contains(name) && !result.contains(name)) result.add(name);
        }
        return result.isEmpty() ? List.of("boss") : result;
    }

    /** 面板展示用的快照。 */
    public Map<String, Object> status() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("enabled", enabled());
        value.put("time", config(KEY_TIME) == null ? "09:30" : config(KEY_TIME));
        value.put("platforms", platforms());
        value.put("lastRun", config(KEY_LAST) == null ? "" : config(KEY_LAST));
        value.put("timeValid", parseTime(config(KEY_TIME)) != null);
        return value;
    }

    private void markRun(String day) {
        try {
            configService.batchUpdateConfigs(Map.of(KEY_LAST, day));
        } catch (RuntimeException error) {
            log.warn("记录定时投递日期失败: {}", error.getMessage());
        }
    }

    private String config(String key) {
        return configService.getConfigValue(key);
    }
}
