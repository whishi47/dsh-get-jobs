package com.getjobs.application.plugin;

import com.getjobs.worker.manager.PlaywrightManager;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 统一的「去登录」入口。
 *
 * <p>原有四个平台的登录触发散落在各自的控制器里，而且只有 51job 与智联暴露了接口，
 * Boss 与猎聘只能在"登录状态发生变化"时被顺带引导一次——用户已经处于未登录态时
 * 再想扫码没有入口。插件面板需要一个可重复调用的按钮，所以这里收一个统一入口。
 *
 * <p><b>为什么是异步</b>：首次调用要先 {@code ensureReady()} 拉起整个浏览器
 * （四个平台页面 + Cookie 恢复），30 秒起步。同步执行会让 HTTP 请求超时，用户看到
 * 的是"点了没反应"，而实际上浏览器窗口正在弹出来。所以立刻返回"已开始"，让前端轮询状态。
 *
 * <p>浏览器是**有头**的：Patchright 无头必被反爬识别，扫码只能在这个可见窗口里完成。
 */
@RestController
@RequestMapping("/api/login")
@CrossOrigin(origins = "*")
public class LoginController {

    private static final Logger log = LoggerFactory.getLogger(LoginController.class);

    /** 支持的平台标识，顺序与前端一致。 */
    private static final List<String> PLATFORMS = List.of("boss", "liepin", "51job", "zhilian");

    private final PlaywrightManager manager;

    /** 正在打开登录页的平台，避免连点把同一个页面导航好几次。 */
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();

    /**
     * 单线程：Playwright 的 Page 不是线程安全的，两个平台同时导航会互相踩。
     * 排队执行，用户点第二次只是延后一点，不会炸。
     */
    private final ExecutorService worker = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "dsh-get-jobs-login");
        thread.setDaemon(true);
        return thread;
    });

    public LoginController(PlaywrightManager manager) {
        this.manager = manager;
    }

    /**
     * 触发登录：把目标平台导航到登录页并尝试切到二维码。
     *
     * @param platform boss / liepin / 51job / zhilian
     */
    @PostMapping("/{platform}")
    public ResponseEntity<Map<String, Object>> trigger(@PathVariable String platform) {
        String id = platform == null ? "" : platform.toLowerCase();
        if (!PLATFORMS.contains(id)) {
            return ResponseEntity.badRequest().body(Map.of(
                    "message", "未知平台：" + platform + "，可选 " + String.join(" / ", PLATFORMS)));
        }

        if (!inFlight.add(id)) {
            return ResponseEntity.ok(body(id, true, "正在准备浏览器，请稍候…"));
        }

        boolean wasReady = manager.isInitialized();
        worker.submit(() -> {
            try {
                switch (id) {
                    case "boss" -> manager.triggerBossLogin();
                    case "liepin" -> manager.triggerLiepinLogin();
                    case "51job" -> manager.trigger51jobLogin();
                    default -> manager.triggerZhilianLogin();
                }
                log.info("登录触发完成: platform={}", id);
            } catch (RuntimeException error) {
                log.warn("登录触发失败: platform={}, error={}", id, error.getMessage());
            } finally {
                inFlight.remove(id);
            }
        });

        String message = wasReady
                ? "已切换到登录页并尝试打开二维码，请在浏览器窗口里扫码；完成后状态会自动更新。"
                : "浏览器尚未启动，正在拉起（首次约 30 秒）。窗口出现后请在其中扫码完成登录。";
        return ResponseEntity.ok(body(id, true, message));
    }

    /** 登录状态。前端触发后轮询这里，扫完码就能看到"已登录"。 */
    @GetMapping("/{platform}/status")
    public ResponseEntity<Map<String, Object>> status(@PathVariable String platform) {
        String id = platform == null ? "" : platform.toLowerCase();
        if (!PLATFORMS.contains(id)) {
            return ResponseEntity.badRequest().body(Map.of("message", "未知平台：" + platform));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("platform", id);
        result.put("isLoggedIn", manager.isLoggedIn(id));
        result.put("initialized", manager.isInitialized());
        result.put("opening", inFlight.contains(id));
        return ResponseEntity.ok(result);
    }

    private static Map<String, Object> body(String platform, boolean accepted, String message) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("platform", platform);
        result.put("accepted", accepted);
        result.put("message", message);
        return result;
    }

    @PreDestroy
    void shutdown() {
        worker.shutdownNow();
    }
}
