output "ecr_url" {
  value = aws_ecr_repository.scraper.repository_url
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "subnets" {
  value = join(",", data.aws_subnets.default.ids)
}

output "task_sg" {
  value = aws_security_group.task.id
}

output "db_cluster_arn" {
  value = aws_rds_cluster.db.arn
}

output "db_secret_arn" {
  value = aws_rds_cluster.db.master_user_secret[0].secret_arn
}