package com.getjobs.application.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import com.getjobs.worker.manager.PlaywrightManager;

/**
 * 应用启动后初始化 Playwright。
 *
 * <p>本服务是纯 HTTP API 后端，界面由 DSH 插件面板提供，因此这里不再做任何
 * 浏览器自动打开动作：不探测 6866 前端端口，也不读取 dist 静态资源。
 * 旧版「启动即弹出管理页面」的行为已移除，避免在使用插件时被额外窗口打断。
 */
@Slf4j
@Component
public class StartupRunner implements ApplicationRunner {

    @Autowired
    private PlaywrightManager playwrightManager;

    @Override
    public void run(ApplicationArguments args) throws Exception {
        try {
            playwrightManager.init();
        } catch (Exception e) {
            log.error("Playwright 初始化失败: {}", e.getMessage());
            throw e;
        }
    }
}
