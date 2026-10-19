resource "aws_iam_role" "scheduler" {
  name = "${local.name}-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_run_task" {
  name = "run-scraper-task"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "ecs:RunTask"
        Resource = "${aws_ecs_task_definition.scraper.arn_without_revision}:*"
      },
      {
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = aws_iam_role.execution.arn
      }
    ]
  })
}

locals {
  schedules = {
    incremental = { cron = "cron(0 3 ? * MON-SAT *)", mode = "startgg-incremental" }
    full = { cron = "cron(0 1 ? * SUN *)", mode = "startgg-full" }
  }
}

resource "aws_scheduler_schedule" "scraper" {
  for_each = local.schedules

  name = "${local.name}-${each.key}"
  schedule_expression = each.value.cron
  schedule_expression_timezone = "America/Los_Angeles"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.scraper.arn_without_revision
      launch_type = "FARGATE"

      network_configuration {
        subnets = data.aws_subnets.default.ids
        security_groups = [aws_security_group.task.id]
        assign_public_ip = true
      }
    }

    input = jsonencode({
      containerOverrides = [{
        name = "scraper"
        environment = [{ name = "SCRAPER_MODE", value = each.value.mode }]
      }]
    })
  }
}