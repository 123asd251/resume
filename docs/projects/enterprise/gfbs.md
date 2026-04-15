# 遥感数据与应用服务平台：多源数据动态引接系统

## 1. 项目背景
国家遥感数据与应用服务平台旨在为国家级决策提供精准的空间信息支撑。其核心挑战之一是异构数据的实时性与一致性。系统需要从多个外部遥感平台（如资源卫星中心、高分专项等）引接数据。我负责开发的数据引接调度模块，通过高度可配置的定时任务集群，实现了多源数据的自动化抓取、清洗、转换（ETL）以及入库，为前端大屏展示提供秒级响应的结构化数据支持。

## 2. 核心挑战
* **多源异构性**：不同平台的数据接口规范不一（RESTful, FTP, 数据库直连），需要灵活的任务调度策略。
* **高可用调度**：任务状态必须与持久化层实时同步，防止因服务重启导致的任务丢失或重复引接。
* **动态管控**：业务人员需在管理后台动态修改 Cron 表达式、启动或关停任务，而无需重新发布后端服务。
* **数据一致性**：在任务状态变更（如停用/重启）时，必须保证内存调度器（Quartz）与数据库状态的事务一致。

## 3. 技术方案：系统基于 Spring Boot 3 架构，引入 Quartz 作为分布式调度引擎，并封装了 JobFacade 业务层
* **动态生命周期管理**：利用 @PostConstruct 在容器启动时自动同步数据库任务至内存调度器，实现“启动即就绪”。
* **编排逻辑解耦**：通过 ScheduleUtils 屏蔽 Quartz 原生复杂的 API，统一任务创建、暂停、恢复逻辑。
* **防御性编程**：引入 Hutool Validator 与 CronUtils 进行严格的参数校验，确保每一条下发到调度引擎的指令都是合法可执行的。
* **弹性扩展**：支持“立即执行一次”功能（runJob），方便在数据引接失败时进行人工干预和手动重试。

## 4. 关键代码实战
```java
/**
 * 编辑/更新定时任务逻辑
 * 核心思路：先删除内存旧任务，同步数据库后再重建调度映射
 */
public Integer editJob(PiJob record) throws SchedulerException, TaskException {
    // 1. 严格校验 Cron 表达式合法性
    boolean isValidCron = CronUtils.isValid(record.getCronExpression());
    Validator.validateTrue(isValidCron, "Cron执行表达式格式有误");

    if (record.getSeqnum() == null) {
        // 新增任务逻辑：默认初始化为停用状态
        record.setIsDeleted(YesNo.NO.getBoolVal());
        record.setJobStatus(JobStatusEnum.停用.getCode());
        jobService.save(record);
    } else {
        // 更新任务逻辑
        PiJob haveJob = jobService.getById(record.getSeqnum());
        Validator.validateNotNull(haveJob, "查找定时任务失败");

        // 2. 属性拷贝与持久化（忽略空值，保证局部更新安全性）
        BeanUtil.copyProperties(record, haveJob, CopyOptions.create().setIgnoreNullValue(true));
        jobService.updateAllById(haveJob);

        // 3. 内存调度器动态刷新
        // 先移除内存中的旧任务
        JobKey jobKey = ScheduleUtils.getJobKey(Long.valueOf(record.getSeqnum()), record.getJobGroup());
        scheduler.deleteJob(jobKey);

        // 根据最新配置重新创建调度
        QuartzJob quartzJob = new QuartzJob();
        BeanUtil.copyProperties(haveJob, quartzJob, true);
        quartzJob.setJobId(Long.valueOf(haveJob.getSeqnum()));
        ScheduleUtils.createScheduleJob(scheduler, quartzJob);

        // 4. 状态联动：如果数据库标记为启用，则立即激活内存调度
        if (JobStatusEnum.启用.getCode().equals(record.getJobStatus())){
            scheduler.resumeJob(jobKey);
        }
    }
    return record.getSeqnum();
}