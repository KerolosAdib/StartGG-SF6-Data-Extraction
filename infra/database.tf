resource "aws_db_subnet_group" "db" {
  name = local.name
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_rds_cluster" "db" {
  cluster_identifier = local.name
  engine = "aurora-postgresql"
  engine_mode = "provisioned"
  engine_version = "16.15"
  database_name = "startgg"
  master_username = "scraper_admin"
  manage_master_user_password = true

  db_subnet_group_name = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.db.id]
  storage_encrypted = true
  enable_http_endpoint = true # RDS Data API, for the console query editor

  backup_retention_period = 1
  skip_final_snapshot = true # personal project: no snapshot on destroy

  serverlessv2_scaling_configuration {
    min_capacity = 0
    max_capacity = 4
    seconds_until_auto_pause = 600
  }
}

resource "aws_rds_cluster_instance" "writer" {
  identifier = "${local.name}-writer"
  cluster_identifier = aws_rds_cluster.db.id
  instance_class = "db.serverless"
  engine = aws_rds_cluster.db.engine
  engine_version = aws_rds_cluster.db.engine_version
  publicly_accessible = false
}