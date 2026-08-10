package com.traceflow.config;

import com.traceflow.work.CreateWorkEventRequest;
import com.traceflow.work.WorkEventRepository;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;

@Component
public class DemoDataInitializer implements CommandLineRunner {
    private final WorkEventRepository events;

    public DemoDataInitializer(WorkEventRepository events) {
        this.events = events;
    }

    @Override
    public void run(String... args) {
        if (events.count() > 0) return;
        events.create(new CreateWorkEventRequest(OffsetDateTime.now().withHour(9).withMinute(35), "GIT", "示例代码平台",
                "示例项目", "完善汇总逻辑并核对业务口径", "完成核心字段与统计范围核验。", "METADATA", 180, true));
        events.create(new CreateWorkEventRequest(OffsetDateTime.now().withHour(13).withMinute(40), "BROWSER", "示例业务平台",
                "示例项目", "排查任务运行结果并验证异常数据", "定位异常来源并形成修正方案。", "METADATA", 180, true));
        events.create(new CreateWorkEventRequest(OffsetDateTime.now().withHour(16).withMinute(10), "MANUAL", "手动补充",
                "项目协作", "同步需求范围与交付计划", "确认后续验证清单及责任分工。", "MANUAL", 120, true));
    }
}
