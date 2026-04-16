import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/resume/',
  title: "ZGH's Portfolio",
  themeConfig: {
    // 导航栏配置
    nav: [
      { text: '首页', link: '/' },
      { text: '项目经验', link: '/projects/enterprise/gfbs' },
      { text: '技术深挖', link: '/tech/mybatis' },
      // { text: '关于我', link: '/about' }
    ],
    // 侧边栏配置
    sidebar: {
    '/projects/': [
      {
        text: '🌍 GIS 公司项目',
        collapsed: true,
        items: [
          { text: '国家遥感数据与应用服务平台', link: '/projects/enterprise/gfbs' },
          { text: '国家检察遥感应用服务平台', link: '/projects/enterprise/jcmp' },
          { text: 'TiTiler 矢量瓦片服务', link: '/projects/enterprise/titiler' },
          { text: '遥感制图平台', link: '/projects/enterprise/rsmp' }
         
        ]
      }
    ],
    '/tech/': [
      {
        text: '⚡ 技术深挖',
        collapsed: true,
        items: [
          { text: 'Mybatis', link: '/tech/mybatis' },
          { text: 'Quartz 分布式任务调度', link: '/tech/quartz' },
          { text: '动态数据源切换', link: '/tech/dynamic-datasource' },
          { text: '线程池管理', link: '/tech/thread-pool' },
          { text: 'Redis 序列化', link: '/tech/redis-serialization' },
          { text: 'Spring Boot 配置管理', link: '/tech/spring-boot-configuration' },
          { text: 'Hutool', link: '/tech/hutool' },
          { text: 'Apache POI', link: '/tech/apache-poi' },
          { text: 'Java 反射', link: '/tech/java-reflection' },
          { text: 'Java 注解', link: '/tech/java-annotations' },
          { text: 'Java 8 Stream API', link: '/tech/java-stream' },
        ]
      }
    ]
  },
    // socialLinks: [
    //   { icon: 'github', link: 'https://github.com/123asd251' }
    // ]
  }
})