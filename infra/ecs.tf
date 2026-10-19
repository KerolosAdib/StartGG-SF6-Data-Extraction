resource "aws_ecr_repository" "scraper" {
  name = local.name
  force_delete = true
}

resource "aws_ecr_lifecycle_policy" "scraper" {
  repository = aws_ecr_repository.scraper.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description = "Keep the last 5 images"
      selection = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecs_cluster" "main" {
  name = local.name
}

resource "aws_cloudwatch_log_group" "scraper" {
  name = "/ecs/${local.name}"
  retention_in_days = 14
}

# Role ECS uses to pull the image, write logs and read secrets
resource "aws_iam_role" "execution" {
  name = "${local.name}-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "execution_base" {
  role = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-scraper-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "secretsmanager:GetSecretValue"
        Resource = aws_rds_cluster.db.master_user_secret[0].secret_arn
      },
      {
        Effect = "Allow"
        Action = "ssm:GetParameters"
        Resource = local.token_param_arn
      }
    ]
  })
}

resource "aws_ecs_task_definition" "scraper" {
  family = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode = "awsvpc"
  cpu = 512
  memory = 1024
  execution_role_arn = aws_iam_role.execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture = "X86_64"
  }

  container_definitions = jsonencode([{
    name = "scraper"
    image = "${aws_ecr_repository.scraper.repository_url}:latest"
    essential = true

    environment = [
      { name = "PGHOST", value = aws_rds_cluster.db.endpoint },
      { name = "PGPORT", value = "5432" },
      { name = "PGDATABASE", value = "startgg" },
      { name = "SCRAPER_MODE", value = "startgg-incremental" }
    ]

    secrets = [
      { name = "PGUSER", valueFrom = "${aws_rds_cluster.db.master_user_secret[0].secret_arn}:username::" },
      { name = "PGPASSWORD", valueFrom = "${aws_rds_cluster.db.master_user_secret[0].secret_arn}:password::" },
      { name = "START_GG_AUTH_TOKEN", valueFrom = local.token_param_arn }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group" = aws_cloudwatch_log_group.scraper.name
        "awslogs-region" = data.aws_region.current.region
        "awslogs-stream-prefix" = "scraper"
      }
    }
  }])
}