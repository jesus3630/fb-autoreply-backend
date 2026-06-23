import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/user.entity';
import { Template } from '../templates/template.entity';

const DEFAULT_TEMPLATES = [
  `Hey! Thanks for reaching out about my listing. It's still available! When would you like to take a look?`,
  `Hi there! Yes, it's still available. I can do cash, Zelle, or Venmo. Let me know if you want to set up a time to see it!`,
  `Thanks for your interest! The price is firm but I'm happy to answer any questions. Want to schedule a viewing?`,
];

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Template) private templates: Repository<Template>,
    private jwt: JwtService,
  ) {}

  async register(email: string, password: string, name?: string) {
    email = email.trim().toLowerCase();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const hashed = await bcrypt.hash(password, 10);
    const user = this.users.create({ email, password: hashed, name });
    await this.users.save(user);

    await this.templates.save(
      DEFAULT_TEMPLATES.map((content) => this.templates.create({ userId: user.id, content }))
    );

    return this.issueToken(user);
  }

  async login(email: string, password: string) {
    email = email.trim().toLowerCase();
    const user = await this.users.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueToken(user);
  }

  private issueToken(user: User) {
    const payload = { sub: user.id, email: user.email, tier: user.tier };
    return {
      access_token: this.jwt.sign(payload),
      user: { id: user.id, email: user.email, name: user.name, tier: user.tier },
    };
  }
}
